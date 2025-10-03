const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const outputPath = path.resolve(__dirname, '../orvilleCommander.zip');
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Zipped successfully! Total bytes: ${archive.pointer()}`);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn(err);
  } else {
    throw err;
  }
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Glob all files, ignoring .git, node_modules, and zips
archive.glob('**/*', {
  cwd: __dirname,
  ignore: ['.git/**', 'node_modules/**', '**/*.zip']
});

archive.finalize();