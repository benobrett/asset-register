export function formatAssetId(assetNumber) {
  return `Item-${String(assetNumber).padStart(2, '0')}`;
}
