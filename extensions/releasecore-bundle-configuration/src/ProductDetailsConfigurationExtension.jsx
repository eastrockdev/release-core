import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  const productId = shopify.data?.selected?.[0]?.id;
  let product = null;
  let errorMessage = null;

  if (productId) {
    const { data, errors } = await shopify.query(
      `#graphql
        query ReleaseCoreBundleProductConfiguration($id: ID!) {
          product(id: $id) {
            id
            title
            variants(first: 10) {
              nodes {
                id
                title
                requiresComponents
                productVariantComponents(first: 30) {
                  nodes {
                    quantity
                    productVariant {
                      id
                      title
                      product {
                        id
                        title
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: productId } },
    );

    if (errors?.length) {
      errorMessage = errors.map((error) => error.message).filter(Boolean).join(" ");
    } else {
      product = data?.product || null;
    }
  }

  render(<Extension product={product} errorMessage={errorMessage} />, document.body);
};

function Extension({ product, errorMessage }) {
  if (errorMessage) {
    return (
      <s-stack direction="block">
        <s-text>ReleaseCore could not load this bundle configuration.</s-text>
        <s-text>{errorMessage}</s-text>
      </s-stack>
    );
  }

  const bundleVariants = (product?.variants?.nodes || []).filter(
    (variant) => variant.requiresComponents,
  );
  const components = bundleVariants.flatMap(
    (variant) => variant.productVariantComponents?.nodes || [],
  );

  return (
    <s-stack direction="block">
      <s-text>Managed by ReleaseCore</s-text>
      <s-text>
        {components.length
          ? `${components.length} track ${components.length === 1 ? "component" : "components"}`
          : "Bundle components are managed from the ReleaseCore Distribution workspace."}
      </s-text>
      {components.map((component) => (
        <s-text key={`${component.productVariant.id}-${component.quantity}`}>
          {component.productVariant.product.title} × {component.quantity}
        </s-text>
      ))}
    </s-stack>
  );
}
