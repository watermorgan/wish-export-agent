/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('http');

async function checkPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          html: data
        });
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Runtime UI Verification ---');
  try {
    const result = await checkPage('http://localhost:3000/');
    console.log(`Status: ${result.status}`);
    
    if (result.status !== 200) {
      console.error(`❌ Page failed to load with status ${result.status}`);
      process.exit(1);
    }

    const html = result.html;
    const markers = [
      { name: 'Workspace Title', pattern: /外贸助手工作台/ },
      { name: 'Start Panel', pattern: /开始翻译/ },
      { name: 'Upload Input', pattern: /data-testid=\"file-input\"/ },
      { name: 'Submit Button', pattern: /data-testid=\"start-translation\"/ },
      { name: 'Result Panel', pattern: /翻译结果/ }
    ];

    let errors = 0;
    markers.forEach(m => {
      if (m.pattern.test(html)) {
        console.log(`✅ ${m.name} found`);
      } else {
        console.error(`❌ ${m.name} NOT found in SSR output`);
        errors++;
      }
    });

    if (errors > 0) process.exit(1);
    console.log('--- Verification Complete: SSR is Healthy ---');
  } catch {
    console.error('❌ Server is not reachable. Is it running?');
    process.exit(1);
  }
}

runTests();
