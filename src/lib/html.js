// Échapper pour du HTML écrit à la main — les flux, qui composent leur contenu
// en chaînes. Les pages Astro n'en ont pas besoin : le gabarit échappe seul.
//
// Dans son propre module parce que deux flux le faisaient chacun de leur côté,
// et qu'un échappement qui diverge est une injection qui attend son heure.

export function escapeHtml(texte) {
  return String(texte ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
