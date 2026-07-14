"use client";

import type { Product } from "@/src/fsd/entities/product";
import styles from "./product-search.module.css";

export function ProductSearch({
  products,
  query,
  onQueryChange,
  onSelect,
}: {
  products: Product[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (product: Product) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = normalizedQuery
    ? products
        .filter((product) =>
          [product.name, product.sku ?? "", product.barcode ?? ""].some((field) => field.toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, 8)
    : [];

  return (
    <div className={styles.search}>
      <input
        placeholder="Поиск товара по названию, артикулу или штрихкоду"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {visibleProducts.length ? (
        <div className={styles.results}>
          {visibleProducts.map((product) => (
            <button key={product.href ?? product.id} type="button" onClick={() => onSelect(product)}>
              <span>{product.name}</span>
              <small>{product.price.toLocaleString("ru-RU")} сом</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
