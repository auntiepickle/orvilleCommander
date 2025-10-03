const fs = require('fs');
const path = require('path');

const outputFile = path.resolve(__dirname, 'orvilleCommander_combined.txt');
const output = fs.createWriteStream(outputFile, { encoding: 'utf8' });
const extensionsToInclude = ['.js', '.html', '.css', '.json', '.txt', '.md']; // Add more if needed
const ignoreDirs = ['node_modules', '.git', '.husky', '.vscode']; // Directories to skip

function combineFiles(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      if (!ignoreDirs.includes(file.name)) {
        combineFiles(fullPath); // Recurse into subdirs
      }
    } else {
      const ext = path.extname(file.name).toLowerCase();
      if (extensionsToInclude.includes(ext)) {
        output.write(`----- ${path.relative(__dirname, fullPath)} -----\n`);
        const content = fs.readFileSync(fullPath, 'utf8');
        output.write(content + '\n');
        output.write('-----\n\n');
      }
    }
  }
}

combineFiles(__dirname);

output.end(() => {
  console.log(`Combined file created at: ${outputFile}`);
});