import { useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const releases = await db.release.findMany({
    where: { shop: session.shop },
    select: {
      id: true,
      title: true,
      shopifyReleaseProductId: true,
      tracks: { select: { shopifyProductId: true } },
    },
  });

  const importedProducts = {};

  for (const release of releases) {
    if (release.shopifyReleaseProductId) {
      importedProducts[release.shopifyReleaseProductId] = {
        releaseId: release.id,
        releaseTitle: release.title,
        source: "RELEASE",
      };
    }

    for (const track of release.tracks || []) {
      if (!track.shopifyProductId) continue;
      importedProducts[track.shopifyProductId] = {
        releaseId: release.id,
        releaseTitle: release.title,
        source: "TRACK",
      };
    }
  }

  return { importedProducts };
};

export default function ImportProductPage() {
  const { importedProducts = {} } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [type, setType] = useState("AUTO");
  const [importState, setImportState] = useState("CATALOG");
  const [titleOverride, setTitleOverride] = useState("");
  const [artistOverride, setArtistOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const importedProductFilter = Object.keys(importedProducts)
    .map((id) => String(id).match(/Product\/(\d+)$/)?.[1])
    .filter(Boolean)
    .map((id) => `-id:${id}`)
    .join(" ");

  const selectProduct = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      filter: {
        variants: false,
        ...(importedProductFilter ? { query: importedProductFilter } : {}),
      },
    });
    if (!selected?.length) return;
    const next = selected[0];
    const existing = importedProducts[next.id];

    if (existing) {
      setProduct(null);
      setNotice({
        tone: "bad",
        message: `${next.title || "This Shopify product"} is already imported into ReleaseCore as “${existing.releaseTitle || "an existing release"}”. Choose a different product.`,
        existingReleaseId: existing.releaseId,
      });
      shopify.toast.show("That Shopify product is already imported");
      return;
    }

    setProduct(next);
    setNotice(null);
    if (!titleOverride) setTitleOverride(next.title || "");
  };

  const importProduct = async () => {
    if (!product?.id || busy) return;

    const existing = importedProducts[product.id];
    if (existing) {
      setProduct(null);
      setNotice({
        tone: "bad",
        message: `${product.title || "This Shopify product"} is already imported into ReleaseCore as “${existing.releaseTitle || "an existing release"}”. Choose a different product.`,
        existingReleaseId: existing.releaseId,
      });
      shopify.toast.show("That Shopify product is already imported");
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("productId", product.id);
      form.set("type", type);
      form.set("importState", importState);
      form.set("titleOverride", titleOverride);
      form.set("artistOverride", artistOverride);
      const result = await authenticatedPost(shopify, "/api/import-product", form);
      if (result.existing) shopify.toast.show("Product already connected to ReleaseCore");
      else shopify.toast.show("Shopify product imported");
      if (result.warnings?.length) sessionStorage.setItem("releasecore-import-warnings", JSON.stringify(result.warnings));
      navigate(`/app/release/${result.releaseId}`);
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not import product." });
    } finally {
      setBusy(false);
    }
  };

  const image = product?.images?.[0]?.originalSrc || product?.images?.[0]?.url || null;

  return (
    <s-page heading="Import Shopify product">
      <s-button slot="primary-action" onClick={() => navigate("/app/releases")}>All releases</s-button>

      <s-section>
        <div style={styles.hero}>
          <div style={styles.eyebrow}>Existing catalog</div>
          <div style={styles.title}>Bring an existing Shopify music product into ReleaseCore.</div>
          <div style={styles.copy}>
            ReleaseCore reads the product title, vendor, featured artwork, SKU, barcode and compatible ReleaseCore/custom metafields. Singles become Track 1; EP and Album products become release-level products and you can build their tracklists afterward.
          </div>
        </div>
      </s-section>

      {notice ? (
        <s-section>
          <div style={styles.notice}>
            <div>{notice.message}</div>
            {notice.existingReleaseId ? (
              <div style={{ marginTop: 10 }}>
                <s-button
                  onClick={() =>
                    navigate(`/app/release/${notice.existingReleaseId}`)
                  }
                >
                  Open existing release
                </s-button>
              </div>
            ) : null}
          </div>
        </s-section>
      ) : null}

      <s-section heading="1. Choose Shopify product">
        {!product ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>Select a product from this Shopify store</div>
            <div style={styles.muted}>Draft, active and archived products can be imported once. Products already connected to a ReleaseCore release are blocked from being imported again. ReleaseCore will never delete or recreate the selected product.</div>
            <div style={{ marginTop: 14 }}><s-button variant="primary" onClick={selectProduct}>Select product</s-button></div>
          </div>
        ) : (
          <div style={styles.productCard}>
            {image ? <img src={image} alt="" style={styles.cover} /> : <div style={{ ...styles.cover, ...styles.coverEmpty }}>No image</div>}
            <div style={{ minWidth: 0 }}>
              <div style={styles.productTitle}>{product.title || "Selected product"}</div>
              <div style={styles.muted}>{product.handle || product.id}</div>
              <div style={{ marginTop: 10 }}><s-button onClick={selectProduct}>Choose different product</s-button></div>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading="2. Import options">
        <div className="rc-import-grid" style={styles.grid}>
          <label style={styles.field}>
            <span style={styles.label}>Release type</span>
            <select className="rc-control" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="AUTO">Auto-detect (default to Single)</option>
              <option value="SINGLE">Single</option>
              <option value="EP">EP</option>
              <option value="ALBUM">Album</option>
            </select>
            <span style={styles.help}>Auto-detect uses an existing releasecore.release_type metafield when available.</span>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Imported release state</span>
            <select className="rc-control" value={importState} onChange={(event) => setImportState(event.target.value)}>
              <option value="CATALOG">Existing / distributed catalog</option>
              <option value="DRAFT">Draft — continue preparing in ReleaseCore</option>
            </select>
            <span style={styles.help}>Existing catalog imports are marked approved and distribution complete without replaying the review workflow.</span>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Release title override</span>
            <input className="rc-control" value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)} placeholder="Use Shopify product title" />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Primary artist override</span>
            <input className="rc-control" value={artistOverride} onChange={(event) => setArtistOverride(event.target.value)} placeholder="Use ReleaseCore metafield or Shopify vendor" />
          </label>
        </div>
        <div style={styles.info}>
          <strong>Identifier mapping</strong>
          <span>Shopify barcode → release UPC · Shopify SKU → catalog number · ReleaseCore/custom ISRC metafield → track ISRC. Existing values are skipped if they would collide with another ReleaseCore record.</span>
        </div>
        <div style={styles.actions}>
          <s-button variant="primary" disabled={!product || busy} onClick={importProduct}>{busy ? "Importing…" : "Import product"}</s-button>
          <s-button onClick={() => navigate("/app/releases")}>Cancel</s-button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

const styles = {
  hero: { padding: "4px 0 8px" },
  eyebrow: { fontSize: 12, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase", color: "#6d7175" },
  title: { fontSize: 28, lineHeight: 1.15, fontWeight: 750, marginTop: 6, maxWidth: 760 },
  copy: { color: "#6d7175", maxWidth: 820, marginTop: 8, lineHeight: 1.5 },
  empty: { border: "1px dashed #c9cccf", borderRadius: 12, padding: "28px 20px", textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: 700, marginBottom: 6 },
  muted: { color: "#6d7175", fontSize: 12 },
  productCard: { display: "grid", gridTemplateColumns: "92px minmax(0,1fr)", gap: 16, alignItems: "center", padding: 14, border: "1px solid #dedede", borderRadius: 12 },
  cover: { width: 92, height: 92, objectFit: "cover", borderRadius: 10, border: "1px solid #dedede" },
  coverEmpty: { display: "grid", placeItems: "center", color: "#8c9196", fontSize: 11, background: "#f6f6f7" },
  productTitle: { fontSize: 17, fontWeight: 750, marginBottom: 4 },
  grid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 12, fontWeight: 700 },
  input: { boxSizing: "border-box", width: "100%", height: 44, minHeight: 44, padding: "9px 11px", border: "1px solid #b7bdc4", borderRadius: 8, backgroundColor: "#fff", font: "inherit" },
  help: { color: "#6d7175", fontSize: 11, lineHeight: 1.4 },
  info: { display: "grid", gap: 4, marginTop: 16, padding: 13, borderRadius: 10, background: "#f6f6f7", color: "#4a4a4a", fontSize: 12 },
  actions: { display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 },
  notice: { padding: 12, border: "1px solid #d72c0d55", borderRadius: 9 },
};
