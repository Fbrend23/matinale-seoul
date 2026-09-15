// La carte Naver de la page Événements : un pin par événement dont on connaît
// l'adresse, posé par le navigateur du lecteur.
//
// Pourquoi le navigateur, et pas le build : les conditions de l'API Recherche
// Naver interdisent de conserver ce qu'elle répond, et c'est la seule API
// Naver qui résout un nom de lieu. On ne stocke donc aucune coordonnée. Le
// site publie l'adresse routière vue par l'agent, un fait tiré de la source,
// et l'API JavaScript Naver Maps la géocode ici, à l'ouverture du bloc, pour
// poser le pin sur une carte Naver : l'usage prévu de l'API. Les réponses
// vivent le temps de la page, jamais dans localStorage.
//
// Rien ne se charge tant que le bloc est replié : ni le script de Naver, ni
// un chargement de carte compté sur le quota. Et sans script, le bloc reste
// caché : une carte vide serait un mensonge, comme un filtre qui ne filtre
// rien.

const SEOUL = { lat: 37.5665, lng: 126.978 };
const ZOOM_VILLE = 11;
const ZOOM_MAX = 15;

/**
 * Le script de l'API, une seule fois, et la promesse qu'il est prêt, sous-
 * module geocoder compris : Naver le charge après maps.js et prévient par
 * `onJSContentLoaded`.
 *
 * @param {string} cle  le client ID (ncpKeyId), public et restreint au domaine
 * @param {(raison: string) => void} surÉchec  quand Naver refuse la clé ou le
 *   domaine : il l'annonce par `navermap_authFailure`, après coup, une fois la
 *   carte déjà dessinée, d'où un rappel plutôt qu'un rejet
 * @returns {Promise<any>}  l'espace `naver.maps`
 */
function chargerNaver(cle, surÉchec) {
  return new Promise((résoudre, rejeter) => {
    const w = /** @type {any} */ (window);
    if (w.naver?.maps?.Service) return résoudre(w.naver.maps);

    w.navermap_authFailure = () => surÉchec('Naver Maps refuse la clé ou le domaine');

    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(cle)}&submodules=geocoder`;
    script.onerror = () => rejeter(new Error('le script Naver Maps ne se charge pas'));
    script.onload = () => {
      const maps = w.naver?.maps;
      if (!maps) return rejeter(new Error('naver.maps absent après chargement'));
      if (maps.Service) return résoudre(maps);
      maps.onJSContentLoaded = () => résoudre(maps);
    };
    document.head.append(script);
  });
}

/**
 * Le contenu de la bulle, construit en DOM : le nom et l'adresse viennent du
 * CMS, on ne les colle pas dans du HTML.
 *
 * @param {HTMLElement} carte  l'article de l'événement
 * @param {() => void} surLien  avant de suivre le lien vers la carte
 */
function bulle(carte, surLien) {
  const boîte = document.createElement('div');
  boîte.className = 'bulle';

  const nom = document.createElement('strong');
  nom.textContent = carte.querySelector('h3')?.textContent ?? '';

  const quand = document.createElement('span');
  quand.textContent = carte.querySelector('.evenement-quand')?.textContent ?? '';

  const où = document.createElement('span');
  où.lang = 'ko';
  où.textContent = carte.dataset.adresse ?? '';

  const lien = document.createElement('a');
  lien.href = `#${carte.id}`;
  lien.textContent = 'Voir l’événement';
  lien.addEventListener('click', surLien);

  boîte.append(nom, quand, où, lien);
  return boîte;
}

/**
 * Prépare le bloc « Sur la carte » et rend de quoi le tenir d'accord avec le
 * filtre : `synchroniser()` montre les pins des cartes visibles, et eux seuls.
 *
 * @param {object} p
 * @param {HTMLDetailsElement} p.bloc     le <details id="sur-la-carte">
 * @param {HTMLElement[]} p.cartes        les articles .evenement de la page
 * @param {boolean} p.surTéléphone        replié au chargement, comme « Plus tard »
 * @returns {{ synchroniser: () => void }}
 */
export function préparerLaCarte({ bloc, cartes, surTéléphone }) {
  const cle = bloc.dataset.cle ?? '';
  const conteneur = bloc.querySelector('.carte-naver');
  const compte = bloc.querySelector('.compte');
  const note = bloc.querySelector('.carte-note');
  if (!cle || !(conteneur instanceof HTMLElement)) return { synchroniser() {} };

  bloc.hidden = false;
  if (surTéléphone) bloc.open = false;

  /** @type {any} */ let maps = null;
  /** @type {any} */ let carte = null;
  /** @type {any} */ let infobulle = null;
  /** @type {Map<HTMLElement, any>} */
  const marqueurs = new Map();
  let chargement = false;

  function synchroniser() {
    if (!carte) return;
    const positions = [];
    for (const [article, marqueur] of marqueurs) {
      const visible = !article.hidden;
      marqueur.setMap(visible ? carte : null);
      if (visible) positions.push(marqueur.getPosition());
    }
    if (compte) compte.textContent = String(positions.length);
    infobulle?.close();

    // Cadrer sur ce qui reste : un pin seul se voit de près, plusieurs se
    // partagent l'écran, aucun rend la ville entière.
    if (positions.length === 0) {
      carte.setCenter(new maps.LatLng(SEOUL.lat, SEOUL.lng));
      carte.setZoom(ZOOM_VILLE);
    } else if (positions.length === 1) {
      carte.setCenter(positions[0]);
      carte.setZoom(ZOOM_MAX);
    } else {
      const bornes = new maps.LatLngBounds(positions[0], positions[0]);
      for (const p of positions) bornes.extend(p);
      carte.fitBounds(bornes, { top: 40, right: 40, bottom: 40, left: 40 });
      if (carte.getZoom() > ZOOM_MAX) carte.setZoom(ZOOM_MAX);
    }
  }

  /** Un pin pour cet article, à la position que Naver a trouvée. */
  function épingler(article, position) {
    // Le thème est une clé du schéma, mais il entre dans du HTML : on le
    // borne à ce qu'une clé peut être.
    const theme = /^[a-z]+$/.test(article.dataset.theme ?? '') ? article.dataset.theme : '';
    const marqueur = new maps.Marker({
      position,
      map: article.hidden ? null : carte,
      title: article.querySelector('h3')?.textContent ?? '',
      icon: {
        content: `<span class="epingle" data-theme="${theme}"></span>`,
        size: new maps.Size(18, 18),
        anchor: new maps.Point(9, 9),
      },
    });
    maps.Event.addListener(marqueur, 'click', () => {
      infobulle.setContent(
        bulle(article, () => {
          // Le lien mène à la carte de l'événement : elle doit être visible,
          // donc son groupe déplié, ce que « Plus tard » n'est pas sur un
          // téléphone.
          const groupe = article.closest('details');
          if (groupe && !groupe.open) groupe.open = true;
        })
      );
      infobulle.open(carte, marqueur);
    });
    marqueurs.set(article, marqueur);
  }

  /** La carte ne viendra pas : le dire, et ne pas laisser un cadre vide. */
  function abandonner(raison) {
    console.debug('[carte]', raison);
    conteneur.hidden = true;
    if (note) note.textContent = 'La carte Naver n’a pas pu se charger.';
    if (compte) compte.textContent = '0';
  }

  async function initialiser() {
    chargement = true;
    try {
      maps = await chargerNaver(cle, abandonner);
    } catch (e) {
      abandonner(e instanceof Error ? e.message : String(e));
      return;
    }

    carte = new maps.Map(conteneur, {
      center: new maps.LatLng(SEOUL.lat, SEOUL.lng),
      zoom: ZOOM_VILLE,
      mapDataControl: false,
      scaleControl: false,
    });
    infobulle = new maps.InfoWindow({
      content: '',
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: true,
      pixelOffset: new maps.Point(0, -12),
    });
    maps.Event.addListener(carte, 'click', () => infobulle.close());

    // Toutes les adresses d'un coup, une réponse à la fois : chaque pin se
    // pose quand il arrive, et le cadrage suit le dernier.
    const avecAdresse = cartes.filter((c) => c.dataset.adresse && c.dataset.termine !== 'oui');
    let restantes = avecAdresse.length;
    if (restantes === 0) synchroniser();
    for (const article of avecAdresse) {
      maps.Service.geocode({ query: article.dataset.adresse }, (statut, réponse) => {
        const trouvé = statut === maps.Service.Status.OK ? réponse?.v2?.addresses?.[0] : null;
        if (trouvé) {
          épingler(article, new maps.LatLng(Number(trouvé.y), Number(trouvé.x)));
        } else {
          console.debug('[carte] adresse non trouvée :', article.dataset.adresse);
        }
        if (--restantes === 0) synchroniser();
      });
    }
  }

  function àLOuverture() {
    if (!bloc.open) return;
    if (!chargement) {
      initialiser();
    } else if (carte) {
      // Replié, le conteneur n'avait plus de taille : la carte doit la
      // reprendre avant de se recadrer.
      maps.Event.trigger(carte, 'resize');
      synchroniser();
    }
  }

  bloc.addEventListener('toggle', àLOuverture);
  àLOuverture();

  return { synchroniser };
}
