using System;
using System.Buffers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Docker.DotNet;
using static Docker.DotNet.MultiplexedStream;

namespace SharpLab.Container.Manager.Internal {
    public class StdoutReader {
        public async Task<(ReadOnlyMemory<char> output, bool failed)> ReadOutputAsync(MultiplexedStream stream, string outputEndMarker, CancellationToken cancellationToken) {
            byte[]? byteBuffer = null;
            char[]? charBuffer = null;
            try {
                byteBuffer = ArrayPool<byte>.Shared.Rent(10240);
                charBuffer = ArrayPool<char>.Shared.Rent(10240);

                return await ReadOutputWithBuffersAsync(stream, outputEndMarker, byteBuffer, charBuffer, cancellationToken);
            }
            finally {
                if (byteBuffer != null)
                    ArrayPool<byte>.Shared.Return(byteBuffer);
                if (charBuffer != null)
                    ArrayPool<char>.Shared.Return(charBuffer);
            }
        }

        private async Task<(ReadOnlyMemory<char> output, bool failed)> ReadOutputWithBuffersAsync(
            MultiplexedStream stream,
            string outputEndMarker,
            byte[] byteBuffer,
            char[] charBuffer,
            CancellationToken cancellationToken
        ) {
            var decoder = Encoding.UTF8.GetDecoder();

            var byteIndex = 0;
            var charIndex = 0;
            var outputEndIndex = -1;
            var cancelled = false;
            while (outputEndIndex < 0) {
                var (read, readCancelled) = await ReadWithCancellationAsync(stream, byteBuffer, byteIndex, byteBuffer.Length - byteIndex, cancellationToken);
                if (readCancelled) {
                    cancelled = true;
                    break;
                }

                if (read.EOF)
                    break;

                decoder.Convert(
                    byteBuffer, byteIndex, read.Count,
                    charBuffer, charIndex, charBuffer.Length - charIndex,
                    flush: false,
                    out _, out var charCount, out _
                );
                var totalCharCount = charIndex + charCount;
                if (totalCharCount >= outputEndMarker.Length) {
                    var earliestOutputEndCheckIndex = Math.Min(charIndex, totalCharCount - outputEndMarker.Length);
                    var relativeOutputEndIndex = ((ReadOnlySpan<char>)charBuffer.AsSpan())
                        .Slice(earliestOutputEndCheckIndex, totalCharCount - earliestOutputEndCheckIndex)
                        .IndexOf(outputEndMarker, StringComparison.Ordinal);
                    if (relativeOutputEndIndex >= 0) {
                        outputEndIndex = earliestOutputEndCheckIndex + relativeOutputEndIndex;
                        break;
                    }
                }

                byteIndex += read.Count;
                charIndex += charCount;
                if (byteIndex >= byteBuffer.Length || charIndex >= charBuffer.Length)
                    break;
            }

            if (cancelled)
                return ((new string(charBuffer, 0, charIndex) + "\n(Execution timed out)").AsMemory(), failed: true);
            if (outputEndIndex < 0)
                return ((new string(charBuffer, 0, charIndex) + "\n(Unexpected end of output)").AsMemory(), failed: true);

            return (charBuffer.AsMemory(0, outputEndIndex), failed: false);
        }

        // Underlying stream does not handle cancellation correctly by default, see
        // https://stackoverflow.com/questions/12421989/networkstream-readasync-with-a-cancellation-token-never-cancels
        private async Task<(ReadResult result, bool cancelled)> ReadWithCancellationAsync(MultiplexedStream stream, byte[] buffer, int index, int count, CancellationToken cancellationToken) {
            var cancellationTaskSource = new TaskCompletionSource<object?>();
            using var _ = cancellationToken.Register(() => cancellationTaskSource.SetResult(null));

            var result = await Task.WhenAny(
                stream.ReadOutputAsync(buffer, index, count, cancellationToken),
                cancellationTaskSource.Task
            );
            if (result == cancellationTaskSource.Task)
                return (default, true);

            return (await (Task<ReadResult>)result, false);
        }
    }
}
