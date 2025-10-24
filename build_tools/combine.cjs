const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'combine');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const srcDir = path.join(__dirname, '..', 'src');
const maxSize = 20000; // Maximum characters per part to avoid truncation issues

let partNumber = 1;
let currentContent = '';
let outputPath = path.join(outputDir, `orvilleCommander_combined_part${partNumber}.txt`);
let output = fs.createWriteStream(outputPath, { encoding: 'utf8' });

function combineFiles() {
  const files = fs.readdirSync(srcDir)
    .filter(file => {
      const fullPath = path.join(srcDir, file);
      return fs.statSync(fullPath).isFile() && !file.endsWith('.css');
    })
    .sort(); // Sort alphabetically for consistent order

  for (const fileName of files) {
    const fullPath = path.join(srcDir, fileName);
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