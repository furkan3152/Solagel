/** Kept for older callers: the SOL beta never sells future NFT skins. */
export function BuySkinButton({ skin: _skin }: { skin: number }) {
  return <span className="badge lav">NFT skin preview · Mint not open</span>;
}
