"use client";

import type { Customer } from "@/src/fsd/entities/customer";
import styles from "./customer-search.module.css";

export function CustomerSearch({
  customers,
  query,
  onQueryChange,
  onSelect,
}: {
  customers: Customer[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCustomers = normalizedQuery
    ? customers
        .filter((customer) => [customer.name, customer.phone ?? ""].some((field) => field.toLowerCase().includes(normalizedQuery)))
        .slice(0, 6)
    : [];

  return (
    <div className={styles.search}>
      <input placeholder="Найти клиента" value={query} onChange={(event) => onQueryChange(event.target.value)} />
      {visibleCustomers.length ? (
        <div className={styles.results}>
          {visibleCustomers.map((customer) => (
            <button key={customer.href ?? customer.id} type="button" onClick={() => onSelect(customer)}>
              <span>{customer.name}</span>
              <small>{customer.phone}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
