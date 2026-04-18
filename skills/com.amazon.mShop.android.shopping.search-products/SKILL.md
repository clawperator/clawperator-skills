---
name: com.amazon.mShop.android.shopping.search-products
description: Search for products in the Amazon Shopping Android app.
---

Performs a product search for a specific query and returns the first accessible titles found on the results page, plus sponsored state and price when those details are exposed in the accessibility tree.

## Usage

```bash
./skills/com.amazon.mShop.android.shopping.search-products/scripts/search_amazon_products.sh <device_id> [query] [operator_package]
```

Example:

```bash
./skills/com.amazon.mShop.android.shopping.search-products/scripts/search_amazon_products.sh <device_serial> "men's razor blades"
```

## Notes

- This is a private draft skill for the configured Amazon account and current app layout.
- The skill prefers the exact typed suggestion row when Amazon exposes it, because IME submit alone can leave the app on the suggestion surface.
- Results are parsed from accessible text on the product results page, so the output is only as complete as the current accessibility tree.
- Prices and sponsored labels are heuristic and depend on how the current Amazon result cards are exposed through accessibility.
