const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractPriceFromWindow,
  extractProducts,
  mergeProductsFromSnapshots
} = require('./amazon_parser');

test('extractPriceFromWindow preserves grouped thousands prices from snapshot lines', () => {
  const lines = [
    '<node index="0" text="2026 13-inch iPad Air (Wi-Fi, 128GB) - Blue (M4)" content-desc="2026 13-inch iPad Air (Wi-Fi, 128GB) - Blue (M4)" clickable="true" />',
    '<node index="1" text="$1,347.00" content-desc="$1,347.00" clickable="false" />',
    '<node index="2" text="FREE delivery" content-desc="FREE delivery" clickable="false" />'
  ];

  assert.strictEqual(extractPriceFromWindow(lines, 1, lines.length), '$1,347.00');
});

test('extractPriceFromWindow preserves ungrouped four-digit prices from snapshot lines', () => {
  const lines = [
    '<node index="0" text="Apple Studio Display" content-desc="Apple Studio Display" clickable="true" />',
    '<node index="1" text="$1999.00" content-desc="$1999.00" clickable="false" />'
  ];

  assert.strictEqual(extractPriceFromWindow(lines, 1, lines.length), '$1999.00');
});

test('extractPriceFromWindow prefers a live price over an RRP-only mention', () => {
  const lines = [
    '<node index="0" text="RRP: $18.99" content-desc="RRP: $18.99" clickable="false" />',
    '<node index="1" text="Prime Savings Save 5% when you buy $40.00 of select items" content-desc="Prime Savings Save 5% when you buy $40.00 of select items" clickable="false" />',
    '<node index="2" text="$17.50" content-desc="$17.50" clickable="false" />'
  ];

  assert.strictEqual(extractPriceFromWindow(lines, 0, lines.length), '$17.50');
});

test('extractProducts reads grouped prices from a minimal Amazon results snapshot', () => {
  const snapshotText = [
    '<hierarchy>',
    '<node text="Results" content-desc="Results" clickable="false" />',
    '<node text="2026 13-inch iPad Air (Wi-Fi, 128GB) - Blue (M4)" content-desc="2026 13-inch iPad Air (Wi-Fi, 128GB) - Blue (M4)" clickable="true" class="android.view.View" />',
    '<node text="$1,347.00" content-desc="$1,347.00" clickable="false" class="android.view.View" />',
    '<node text="2026 13-inch iPad Air (Wi-Fi, 256GB) - Starlight (M4)" content-desc="2026 13-inch iPad Air (Wi-Fi, 256GB) - Starlight (M4)" clickable="true" class="android.view.View" />',
    '<node text="$1,547.00" content-desc="$1,547.00" clickable="false" class="android.view.View" />',
    '</hierarchy>'
  ].join('\n');

  assert.deepStrictEqual(extractProducts(snapshotText, 'iPad Air M4 13"'), [
    {
      title: '2026 13-inch iPad Air (Wi-Fi, 128GB) - Blue (M4)',
      sponsored: false,
      price: '$1,347.00'
    },
    {
      title: '2026 13-inch iPad Air (Wi-Fi, 256GB) - Starlight (M4)',
      sponsored: false,
      price: '$1,547.00'
    }
  ]);
});

test('mergeProductsFromSnapshots backfills missing price from a later snapshot without reordering', () => {
  const firstSnapshot = [
    '<hierarchy>',
    '<node text="Results" content-desc="Results" clickable="false" />',
    '<node text="Apple AirPods 4" content-desc="Apple AirPods 4" clickable="true" class="android.view.View" />',
    '<node text="Sponsored Ad - Beats Flex Wireless Earphones" content-desc="Sponsored Ad - Beats Flex Wireless Earphones" clickable="true" class="android.view.View" />',
    '<node text="$77.00" content-desc="$77.00" clickable="false" class="android.view.View" />',
    '</hierarchy>'
  ].join('\n');

  const secondSnapshot = [
    '<hierarchy>',
    '<node text="Results" content-desc="Results" clickable="false" />',
    '<node text="Apple AirPods 4" content-desc="Apple AirPods 4" clickable="true" class="android.view.View" />',
    '<node text="$199.00" content-desc="$199.00" clickable="false" class="android.view.View" />',
    '</hierarchy>'
  ].join('\n');

  assert.deepStrictEqual(mergeProductsFromSnapshots([firstSnapshot, secondSnapshot], 'AirPods'), [
    {
      title: 'Apple AirPods 4',
      sponsored: false,
      price: '$199.00'
    },
    {
      title: 'Beats Flex Wireless Earphones',
      sponsored: true,
      price: '$77.00'
    }
  ]);
});
