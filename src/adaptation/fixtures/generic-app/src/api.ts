export async function loadWidgets() {
  return fetch("/api/widgets");
}

export async function createInvoice() {
  return fetch("/api/billing/invoices", {
    method: "POST",
  });
}
