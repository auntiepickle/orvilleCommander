const fs = require('fs');
const path = require('path');

const outputDir = path.resolve(__dirname, 'combine');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const filesToInclude = ['config.js', 'controls.js', 'index.html', 'main.js', 'midi.js', 'parser.js', 'renderer.js', 'state.js'];
const maxSize = 20000; // Maximum characters per part to avoid truncation issues

let partNumber = 1;
let currentContent = '';
let outputPath = path.join(outputDir, `orvilleCommander_combined_part${partNumber}.txt`);
let output = fs.createWriteStream(outputPath, { encoding: 'utf8' });

function combineFiles() {
  for (const fileName of filesToInclude) {
    const fullPath = path.join(__dirname, fileName);
    if (fs.existsSync(fullPath)) {
      const header = `----- ${fileName} -----\n`;
      const content = fs.readFileSync(fullPath, 'utf8') + '\n';
      const footer = '-----\n\n';
      const addition = header + content + footer;

      if (currentContent.length + addition.length > maxSize && currentContent.length > 0) {
        output.end();
        console.log(`Part ${partNumber} created at: ${outputPath}`);
        partNumber++;
        currentContent = '';
        outputPath = path.join(outputDir, `orvilleCommander_combined_part${partNumber}.txt`);
        output = fs.createWriteStream(outputPath, { encoding: 'utf8' });
      }

      output.write(addition);
      currentContent += addition;
    } else {
      console.warn(`File not found: ${fileName}`);
    }
  }
}

combineFiles();

output.end(() => {
  console.log(`Part ${partNumber} created at: ${outputPath}`);
  // Calculate total lines across all parts
  let totalLines = 0;
  for (let i = 1; i <= partNumber; i++) {
    const partPath = path.join(outputDir, `orvilleCommander_combined_part${i}.txt`);
    const partContent = fs.readFileSync(partPath, 'utf8');
    totalLines += partContent.split('\n').length;
  }
  console.log(`Total lines across all parts: ${totalLines}`);
});