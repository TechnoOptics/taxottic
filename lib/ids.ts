const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function userPublicId(): string {
  return `tax_${randomSuffix(10)}`;
}

export function companyPublicId(): string {
  return `co_${randomSuffix(10)}`;
}

export function invitationToken(): string {
  return randomSuffix(32);
}
