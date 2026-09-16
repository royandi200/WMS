const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function frontendSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', relativePath), 'utf8');
}

test('dashboard has no approvals section or navigation, while operational approval code remains separate', () => {
  for (const file of [
    'App.jsx',
    'components/Sidebar.jsx',
    'components/BottomNav.jsx',
    'pages/DashboardPage.jsx',
  ]) {
    const source = frontendSource(file);
    assert.doesNotMatch(source, /aprobaciones|approvals|AprobacionesPage/iu, file);
  }

  const dashboard = frontendSource('pages/DashboardPage.jsx');
  assert.match(dashboard, /title="Recepciones"/u);
  assert.match(dashboard, /title="Producción"/u);
  assert.match(dashboard, /title="Mermas"/u);
});
