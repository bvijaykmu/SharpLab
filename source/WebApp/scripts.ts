import { promisify } from 'util';
import { task, build as run } from 'oldowan';
import jetpack from 'fs-jetpack';
import waitOn from 'wait-on';
import kill from 'tree-kill';
import { exec2, outputSharedRoot } from './scripts/shared';
import { less } from './scripts/less';
import { ts } from './scripts/ts';
import { deps } from './scripts/deps';
import { icons } from './scripts/icons';
import { manifest } from './scripts/manifest';
import { html, htmlOutputPath } from './scripts/html';

const dirname = __dirname;
const UPDATE_SNAPSHOTS_KEY = 'SHARPLAB_TEST_UPDATE_SNAPSHOTS';

const latest = task('latest', () => jetpack.writeAsync(
    `${outputSharedRoot}/latest`, htmlOutputPath.replace(outputSharedRoot, '').replace(/^[\\/]/, '')
));

const build = task('build', async () => {
    await jetpack.removeAsync(outputSharedRoot);
    await Promise.all([
        deps(),
        less(),
        ts(),
        icons(),
        manifest(),
        html(),
        latest()
    ]);
});

task('start', () => build(), {
    watch: () => exec2('http-server', [outputSharedRoot, '-p', '44200', '--cors'])
});

// Assumes we already ran the build
const zip = task('zip', async () => {
    const AdmZip = (await import('adm-zip')).default;

    const zip = new AdmZip();
    zip.addLocalFolder(outputSharedRoot);
    zip.writeZip(`${dirname}/WebApp.zip`);
});

task('build-ci', async () => {
    if (process.env.NODE_ENV !== 'production')
        throw new Error('Command build-ci should only be run under NODE_ENV=production.');
    await build();
    await zip();
});

task('test-storybook-ci-in-container', async () => {
    console.log('http-server: starting');
    const server = exec2('http-server', ['storybook-static', '--port', '6006', '--silent']);
    try {
        await waitOn({
            resources: ['http://localhost:6006'],
            timeout: 120000
        });
        console.log('http-server: ready');

        const updateSnapshots = process.env[UPDATE_SNAPSHOTS_KEY] === 'true';
        console.log(`Starting Storybook tests${updateSnapshots ? ' (with snapshot update)' : ''}...`);
        await exec2('test-storybook', updateSnapshots ? ['--', '--updateSnapshot'] : []);
    }
    finally {
        if (!server.killed) {
            console.log('http-server: terminating');
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            await promisify(kill)(server.pid!);
        }
    }
}, {
    timeout: 20 * 60 * 1000
});

task('test-storybook-ci', async () => {
    console.log('Starting Docker...');
    await exec2('docker', [
        'run',
        '--rm',
        '--ipc=host',
        `--volume=${dirname}:/work`,
        '--workdir=/work',
        ...(process.env[UPDATE_SNAPSHOTS_KEY] === 'true' ? ['--env', `${UPDATE_SNAPSHOTS_KEY}=true`] : []),
        'mcr.microsoft.com/playwright:v1.22.2-focal',
        'npm', 'run', 'test-storybook-ci-in-container'
    ]);
}, {
    timeout: 20 * 60 * 1000
});

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();