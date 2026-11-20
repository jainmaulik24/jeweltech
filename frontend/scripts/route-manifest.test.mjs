import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const goldOrderDemoSource = readFileSync(
  new URL('../src/GoldOrderDemo.tsx', import.meta.url),
  'utf8',
);
test('jeweller and karigar sign-ins reach the customer-to-karigar demo loop', () => {
  assert.match(appSource, /if \(user\.role !== 'staff'\)[\s\S]*?<GoldOrderDemo/);
  assert.match(goldOrderDemoSource, /id: 'customers', label: 'Customers'/);
  assert.match(goldOrderDemoSource, /assignCustomerOrder/);
  assert.match(goldOrderDemoSource, /deliverCustomerOrder/);
  assert.match(goldOrderDemoSource, /Update customer/);
  assert.match(goldOrderDemoSource, /Customer updated \(demo\)/);
  assert.match(goldOrderDemoSource, /customerUpdate\.text/);
  assert.doesNotMatch(goldOrderDemoSource, /https:\/\/wa\.me\//);
  assert.match(goldOrderDemoSource, /label htmlFor="demo-jeweller"[\s\S]*?Select Jeweller/);
  assert.match(goldOrderDemoSource, /<option value="" disabled>Select a Jeweller<\/option>/);
  assert.match(goldOrderDemoSource, /'Jain Jewellers'[\s\S]*'Mysore Jewels'/);
  assert.match(goldOrderDemoSource, /\{selectedDemoJeweller && \([\s\S]*?\{karigarPortal/);
  assert.match(goldOrderDemoSource, /same synthetic slips are shown for every Jeweller/);
});

test('karigar voice input follows the selected language and targets the active field', () => {
  assert.match(goldOrderDemoSource, /useSpeech\(speechLanguage\(language\), handleTranscript\)/);
  assert.match(goldOrderDemoSource, /const target = speechTargetRef\.current/);
  assert.match(goldOrderDemoSource, /speechTargetRef\.current = target/);
  assert.match(goldOrderDemoSource, /englishSpokenNumbers/);
  assert.match(goldOrderDemoSource, /(?:point\|दशमलव)/);
  assert.match(goldOrderDemoSource, /parseWeight\(spoken, false, true\)/);
  assert.match(goldOrderDemoSource, /\[target\]: `\$\{amountGrams\} g`/);
  assert.match(goldOrderDemoSource, /not a wastage number/);
});
