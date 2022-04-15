import path from 'path';
import { task, exec, build as run } from 'oldowan';
import execa from 'execa';
import jetpack from 'fs-jetpack';

const dirname = __dirname;

const outputSharedRoot = `${dirname}/public`;
const outputVersion = process.env.NODE_ENV === 'ci'
    ? (process.env.SHARPLAB_WEBAPP_BUILD_VERSION ?? (() => { throw 'SHARPLAB_WEBAPP_BUILD_VERSION was not provided.'; })())
    : Date.now();
const outputVersionRoot = `${outputSharedRoot}/${outputVersion}`;

// TODO: expose in oldowan
const exec2 = (command: string, args: ReadonlyArray<string>) => execa(command, args, {
    preferLocal: true,
    stdout: process.stdout,
    stderr: process.stderr
});

const iconSizes = [
    16, 32, 64, 72, 96, 120, 128, 144, 152, 180, 192, 196, 256, 384, 512
];

const depsCheckDuplicates = task('deps:check-duplicates', async () => {
    const output = (await execa('npm', ['find-dupes'])).stdout;
    if (output.length > 0)
        throw new Error(`npm find-duplicates has discovered duplicates:\n${output}`);
});

const deps = task('deps', () => Promise.all([
    depsCheckDuplicates()
]));

const less = task('less', async () => {
    const lessRender = (await import('less')).default;
    const postcss = (await import('postcss')).default;
    // @ts-expect-error (no typings)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const csso = (await import('postcss-csso')).default;
    const autoprefixer = (await import('autoprefixer')).default;

    const sourcePath = `${dirname}/less/app.less`;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const content = (await jetpack.readAsync(sourcePath))!;
    let { css, map } = await lessRender.render(content, {
        filename: sourcePath,
        sourceMap: {
            sourceMapBasepath: `${dirname}`,
            outputSourceFiles: true
        }
    });
    // @ts-expect-error (TODO: need to sort out 'map' type here)
    ({ css, map } = await postcss([
        autoprefixer,
        // no typings for csso
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        csso({ restructure: false })
    ]).process(css, {
        from: sourcePath,
        map: {
            inline: false,
            prev: map
        }
    }));

    const outputPath = `${outputVersionRoot}/app.min.css`;
    await Promise.all([
        jetpack.writeAsync(outputPath, css),
        jetpack.writeAsync(outputPath + '.map', map)
    ]);
}, { watch: [`${dirname}/less/**/*.less`] });

const tsLint = task('ts:lint', () => exec('eslint . --max-warnings 0 --ext .js,.ts'));
const tsInputPath = `${dirname}/ts/app.ts`;
const jsOutputPath = `${outputVersionRoot}/app.min.js`;
const esbuildArgs = [
    tsInputPath,
    '--bundle', '--minify', '--sourcemap',
    `--outfile=${jsOutputPath}`,
    `--tsconfig=${dirname}/tsconfig.build.json`
];
const tsMain = task('ts:main', () => exec2('esbuild', esbuildArgs), {
    watch: () => exec2('esbuild', [...esbuildArgs, '--watch'])
});

const asmSourcePath = `${dirname}/components/internal/codemirror/mode-asm-instructions.txt`;
const tsAsmRegex = task('ts:asm-regex', async () => {
    // @ts-expect-error (no typings)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const regexCombiner = (await import('regex-combiner')).default;
    const asmOutputPath = `${dirname}/components/internal/codemirror/mode-asm-instructions.ts`;

    // read list file as array of lines
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const listContents  = ((await jetpack.readAsync(asmSourcePath))!)
        .split(/\r?\n/);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const regexPattern: string = regexCombiner(listContents).toString();

    const outputContents = [ "// This file is generated by 'tsAsmRegex' task defined in 'source/WebApp/scripts.ts'",
        `export default ${regexPattern};` ].join('\r\n');

    await jetpack.writeAsync(asmOutputPath, outputContents);
}, {
    watch: [ asmSourcePath ]
});

const ts = task('ts', async () => {
    await tsAsmRegex();
    await Promise.all([
        tsLint(),
        tsMain()
    ]);
});

const iconSvgSourcePath = `${dirname}/icon.svg`;
const icons = task('icons', async () => {
    const sharp = (await import('sharp')).default;

    await jetpack.dirAsync(outputVersionRoot);

    await jetpack.copyAsync(iconSvgSourcePath, `${outputVersionRoot}/icon.svg`, { overwrite: true });
    // Not parallelizing with Promise.all as sharp seems to be prone to timeouts when running in parallel
    for (const size of iconSizes) {
        // https://github.com/lovell/sharp/issues/729
        const density = size > 128 ? Math.round(72 * size / 128) : 72;
        await sharp(iconSvgSourcePath, { density })
            .resize(size, size)
            .png()
            .toFile(`${outputVersionRoot}/icon-${size}.png`);
    }
}, {
    timeout: 60000,
    watch: [iconSvgSourcePath]
});

const manifestSourcePath = `${dirname}/manifest.json`;
const manifest = task('manifest', async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const content = JSON.parse((await jetpack.readAsync(manifestSourcePath))!) as {
        icons: ReadonlyArray<{ src: string }>;
    };

    content.icons = content.icons.flatMap(icon => {
        if (!icon.src.includes('{build:each-size}'))
            return [icon];

        const template = JSON.stringify(icon); // simpler than Object.entries
        return iconSizes.map(size => JSON.parse(
            template.replace(/\{(?:build:each-)?size\}/g, size.toString())
        ) as typeof icon);
    });

    await jetpack.writeAsync(`${outputVersionRoot}/manifest.json`, JSON.stringify(content));
}, { watch: [manifestSourcePath] });

const htmlSourcePath = `${dirname}/index.html`;
const htmlOutputPath = `${outputVersionRoot}/index.html`;
const html = task('html', async () => {
    const htmlMinifier = (await import('html-minifier')).default;

    const iconDataUrl = await getIconDataUrl();
    const templates = await getCombinedTemplates(htmlMinifier);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let html = (await jetpack.readAsync(htmlSourcePath))!;
    html = html
        .replace('{build:js}', 'app.min.js')
        .replace('{build:css}', 'app.min.css')
        .replace('{build:templates}', templates)
        .replace('{build:favicon-svg}', iconDataUrl);
    html = htmlMinifier.minify(html, { collapseWhitespace: true });
    await jetpack.writeAsync(htmlOutputPath, html);
}, {
    watch: [
        `${dirname}/components/**/*.html`,
        htmlSourcePath,
        iconSvgSourcePath
    ]
});

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
    if (process.env.NODE_ENV !== 'ci')
        throw new Error('Command build-ci should only be run under NODE_ENV=ci.');
    await build();
    await zip();
});

async function getIconDataUrl() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const faviconSvg = (await jetpack.readAsync(iconSvgSourcePath))!;
    // http://codepen.io/jakob-e/pen/doMoML
    return faviconSvg
        .replace(/"/g, '\'')
        .replace(/%/g, '%25')
        .replace(/#/g, '%23')
        .replace(/{/g, '%7B')
        .replace(/}/g, '%7D')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/\s+/g, ' ');
}

async function getCombinedTemplates(
    htmlMinifier: typeof import('html-minifier')
) {
    const basePath = `${dirname}/components`;
    const htmlPaths = await jetpack.findAsync(basePath, { matching: '*.html' });
    const htmlPromises = htmlPaths.map(async htmlPath => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const template = (await jetpack.readAsync(htmlPath))!;
        const minified = htmlMinifier.minify(template, { collapseWhitespace: true });
        return `<script type="text/x-template" id="${path.basename(htmlPath, '.html')}">${minified}</script>`;
    });
    return (await Promise.all(htmlPromises)).join('\r\n');
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();