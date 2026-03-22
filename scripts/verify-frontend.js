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
      { name: 'Branding', pattern: /The Atelier/i },
      { name: 'Theme Support', pattern: /data-theme/i },
      { name: 'Role Switcher', pattern: /Salesperson|Supervisor/i },
      { name: 'Workspace', pattern: /Workspace/i },
      { name: 'Sidebar', pattern: /<aside/i }
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

    // Check for hydration error signs in HTML (like specific broken classes from the user log)
    if (html.includes('bg-primary/5') && html.includes('Sidebar')) {
      console.warn('⚠️ Found legacy bg-primary/5 in SSR. Should be bg-accent-soft.');
    }

    if (errors > 0) process.exit(1);
    console.log('--- Verification Complete: SSR is Healthy ---');
  } catch (e) {
    console.error('❌ Server is not reachable. Is it running?');
    process.exit(1);
  }
}

runTests();
