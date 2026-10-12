// Retired. This seeder deleted every property document in the database before regenerating them, with no household
// scoping. Its work now lives in seed-demo-documents, which only touches the demo households it is told about.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "seed-property-documents is retired. Use seed-demo-documents with ?families=<ids>." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
