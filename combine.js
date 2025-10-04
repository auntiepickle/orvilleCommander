const fs = require('fs');
const path = require('path');

const outputFile = path.resolve(__dirname, 'orvilleCommander_combined.txt');
const output = fs.createWriteStream(outputFile, { encoding: 'utf8' });
const filesToInclude = ['config.js', 'controls.js', 'index.html', 'main.js', 'midi.js', 'parser.js', 'renderer.js', 'state.js'];

function combineFiles() {
  for (const fileName of filesToInclude) {
    const fullPath = path.join(__dirname, fileName);
    if (fs.existsSync(fullPath)) {
      output.write(`----- ${fileName} -----\n`);
      const content = fs.readFileSync(fullPath, 'utf8');
      output.write(content + '\n');
      output.write('-----\n\n');
    } else {
      console.warn(`File not found: ${fileName}`);
    }
  }
}

combineFiles();

output.end(() => {
  console.log(`Combined file created at: ${outputFile}`);
  const combinedContent = fs.readFileSync(outputFile, 'utf8');
  const lineCount = combinedContent.split('\n').length;
  console.log(`Total lines in combined file: ${lineCount}`);
});