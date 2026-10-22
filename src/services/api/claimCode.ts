export function parseClaimCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^KNK-(?:[A-F0-9]{32}|[A-F0-9]{8}-[A-F0-9]{8})$/.test(code))
    throw new Error('This is not a KONEK reward QR code. Ask the customer to open the code in My rewards.')
  return code
}
