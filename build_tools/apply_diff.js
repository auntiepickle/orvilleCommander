const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.log('Usage: node apply_diff.js <base_name>');
  console.log('Example: node apply_diff.js main (applies main.diff to main.js/html/css)');
  process.exit(1);
}

const baseName = args[0];
const possibleExtensions = ['.js', '.html', '.css'];
let targetFile = null;

for (const ext of possibleExtensions) {
  const candidate = path.resolve(baseName + ext);
  if (fs.existsSync(candidate)) {
    targetFile = candidate;
    break;
  }
}

if (!targetFile) {
  console.log(`No file found for ${baseName} with extensions: ${possibleExtensions.join(', ')}`);
  process.exit(1);
}

const diffFile = path.resolve(baseName + '.diff');
if (!fs.existsSync(diffFile)) {
  console.log(`Diff file not found: ${diffFile}`);
  process.exit(1);
}

const backupFile = targetFile + '.bak';

// Backup original
fs.copyFileSync(targetFile, backupFile);
console.log(`Backup created: ${backupFile}`);

// Try git apply first (handles line endings best)
try {
  child_process.execSync(`git apply --reject --whitespace=fix ${diffFile}`, { stdio: 'inherit' });
  console.log('Diff applied successfully with git apply.');
} catch (err) {
  console.log('git apply failed. Falling back to manual hunk application...');
  // Parse diff and apply manually (simple for single-hunk diffs)
  const diffContent = fs.readFileSync(diffFile, 'utf8').replace(/\r\n/g, '\n'); // Normalize to LF
  const hunks = diffContent.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@[\s\S]*?(?=(@@|$))/g) || [];
  let fileContent = fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').split('\n');

  hunks.forEach(hunk => {
    const match = hunk.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
    if (match) {
      const oldStart = parseInt(match[1], 10) - 1; // 0-index
      const lines = hunk.split('\n').slice(1, -1); // Hunk lines without @@
      let currentLine = oldStart;
      lines.forEach(line => {
        if (line.startsWith('-')) {
          if (fileContent[currentLine].trim() === line.slice(1).trim()) fileContent.splice(currentLine, 1);
        } else if (line.startsWith('+')) {
          fileContent.splice(currentLine, 0, line.slice(1));
          currentLine++;
        } else {
          currentLine++;
        }
      });
    }
  });

  fs.writeFileSync(targetFile, fileContent.join('\n'));
  console.log('Manual application complete. Check for issues.');
}