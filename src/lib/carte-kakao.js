// La carte de la page Événements : un pin par lieu que Kakao Map sait placer,
// posé par le navigateur du lecteur.
//
// Pourquoi le navigateur, et pas le build : les conditions des API de
// recherche de Naver, et de Kakao, interdisent de conserver ce qu'elles
// répondent. On ne stocke donc aucune coordonnée. Le site publie ce que
// l'agent a vu, le lieu tel que la carte l'écrit et, quand il l'a, l'adresse
// routière, et le SDK JavaScript Kakao Maps les résout ici, à l'ouverture du
// bloc, pour poser le pin sur une carte Kakao : l'usage prévu du SDK. Les
// réponses vivent le temps de la page, jamais dans localStorage.
//
// L'adresse d'abord, quand il y en a une : elle désigne un point. Sinon le
// lieu, par mot-clé, et seulement si le nom que Kakao rend est bien celui
// qu'on a demandé : une recherche pose une question, elle n'affirme rien, et
// un pin sur un homonyme affirmerait.
//
// Rien ne se charge tant que le bloc est replié : ni le SDK, ni un
// chargement de carte compté sur le quota. Et sans script, le bloc reste
// caché : une carte vide serait un mensonge, comme un filtre qui ne filtre
// rien.

import { normaliserLieu } from '../../shared/evenements.mjs';

const SEOUL = { lat: 37.5665, lng: 126.978 };
// Le rectangle de Séoul : une recherche par mot-clé n'y sort pas, un
// homonyme à Busan ne peut pas répondre.
const SEOUL_SW = { lat: 37.42, lng: 126.76 };
const SEOUL_NE = { lat: 37.71, lng: 127.19 };
// Les niveaux de Kakao vont du plus près (1) au plus loin (14).
const NIVEAU_VILLE = 8;
const NIVEAU_PROCHE = 3;

/**
 * Le SDK, une seule fois, et la promesse qu'il est prêt, bibliothèque
 * `services` (géocodage, recherche) comprise. `autoload=false` : c'est
 * `kakao.maps.load` qui dit quand tout est là.
 *
 * Un domaine non déclaré ou une clé inconnue : Kakao refuse le script
 * lui-même, ce qui tombe dans `onerror`.
 *
 * @param {string} cle  la clé JavaScript de l'application, publique et
 *   restreinte aux domaines déclarés
 * @returns {Promise<any>}  l'espace `kakao.maps`
 */
function chargerKakao(cle) {
  return new Promise((résoudre, rejeter) => {
    const w = /** @type {any} */ (window);
    if (w.kakao?.maps?.services) return résoudre(w.kakao.maps);

    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cle)}&libraries=services&autoload=false`;
    script.onerror = () => rejeter(new Error('le SDK Kakao Maps ne se charge pas : clé ou domaine refusé'));
    script.onload = () => {
      const maps = w.kakao?.maps;
      if (!maps?.load) return rejeter(new Error('kakao.maps absent après chargement'));
      maps.load(() => résoudre(maps));
    };
    document.head.append(script);
  });
}

// La comparaison des noms de lieu est celle des pages par lieu : une seule
// règle, dans shared/evenements.mjs.
const normaliser = normaliserLieu;

/**
 * Le contenu de la bulle, construit en DOM : le nom et l'adresse viennent du
 * CMS, on ne les colle pas dans du HTML.
 *
 * @param {HTMLElement} carte  l'article de l'événement
 * @param {string} où          l'adresse, la nôtre ou celle que Kakao a rendue
 * @param {(e: MouseEvent) => void} surLien  le clic sur le lien vers la carte
 */
function bulle(carte, où, surLien) {
  const boîte = document.createElement('div');
  boîte.className = 'bulle';

  const nom = document.createElement('strong');
  nom.textContent = carte.querySelector('h3')?.textContent ?? '';

  const quand = document.createElement('span');
  quand.textContent = carte.querySelector('.evenement-quand')?.textContent ?? '';

  const adresse = document.createElement('span');
  adresse.lang = 'ko';
  adresse.textContent = où;

  const lien = document.createElement('a');
  lien.href = `#${carte.id}`;
  lien.textContent = 'Voir l’événement';
  lien.addEventListener('click', surLien);

  boîte.append(nom, quand, adresse, lien);
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
  const conteneur = bloc.querySelector('.carte-kakao');
  const compte = bloc.querySelector('.compte');
  const note = bloc.querySelector('.carte-note');
  if (!cle || !(conteneur instanceof HTMLElement)) return { synchroniser() {} };

  bloc.hidden = false;
  if (surTéléphone) bloc.open = false;

  /** @type {any} */ let maps = null;
  /** @type {any} */ let carte = null;
  /** @type {any} */ let infobulle = null;
  /** @type {Map<HTMLElement, any>} */
  const pins = new Map();
  let chargement = false;

  function synchroniser() {
    if (!carte) return;
    const positions = [];
    for (const [article, pin] of pins) {
      const visible = !article.hidden;
      pin.setMap(visible ? carte : null);
      if (visible) positions.push(pin.getPosition());
    }
    if (compte) compte.textContent = String(positions.length);
    infobulle?.setMap(null);

    // Cadrer sur ce qui reste : un pin seul se voit de près, plusieurs se
    // partagent l'écran, aucun rend la ville entière.
    if (positions.length === 0) {
      carte.setCenter(new maps.LatLng(SEOUL.lat, SEOUL.lng));
      carte.setLevel(NIVEAU_VILLE);
    } else if (positions.length === 1) {
      carte.setCenter(positions[0]);
      carte.setLevel(NIVEAU_PROCHE);
    } else {
      const bornes = new maps.LatLngBounds();
      for (const p of positions) bornes.extend(p);
      carte.setBounds(bornes, 40, 40, 40, 40);
      if (carte.getLevel() < NIVEAU_PROCHE) carte.setLevel(NIVEAU_PROCHE);
    }
  }

  /** Un pin pour cet article, à la position que Kakao a trouvée. */
  function épingler(article, position, où) {
    const épingle = document.createElement('span');
    épingle.className = 'epingle';
    épingle.dataset.theme = article.dataset.theme ?? '';
    épingle.title = article.querySelector('h3')?.textContent ?? '';
    // Un overlay HTML plutôt qu'un marqueur image : c'est la feuille de style
    // qui le colore au thème. Il ne reçoit pas les événements de Kakao, mais
    // c'est un élément à nous : le clic s'écoute dessus.
    épingle.addEventListener('click', () => {
      infobulle.setContent(
        bulle(article, où, (e) => {
          // Le lien mène à la carte de l'événement. Pas par l'ancre : la
          // carte Kakao avale la navigation d'un lien posé sur elle. On
          // déplie le groupe, « Plus tard » ne l'est pas sur un téléphone, et
          // on y va soi-même.
          e.preventDefault();
          const groupe = article.closest('details');
          if (groupe && !groupe.open) groupe.open = true;
          infobulle.setMap(null);
          article.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', `#${article.id}`);
        })
      );
      infobulle.setPosition(position);
      infobulle.setMap(carte);
      // Le pin sous les yeux, et la bulle au-dessus de lui, entière : au
      // bord de la carte elle serait coupée.
      carte.panTo(position);
    });

    // clickable : un clic sur le pin ou la bulle ne compte pas comme un clic
    // sur la carte, qui fermerait la bulle qu'on vient d'ouvrir.
    const pin = new maps.CustomOverlay({
      position,
      content: épingle,
      xAnchor: 0.5,
      yAnchor: 0.5,
      clickable: true,
      map: article.hidden ? null : carte,
    });
    pins.set(article, pin);
  }

  /**
   * Où est ce lieu ? L'adresse si on l'a, le lieu par mot-clé sinon, et dans
   * ce cas seulement si Kakao rend bien le nom demandé.
   *
   * @param {HTMLElement} article
   * @returns {Promise<{position: any, où: string} | null>}
   */
  function situer(article) {
    const adresse = article.dataset.adresse ?? '';
    const lieu = article.querySelector('.evenement-ou [lang="ko"]')?.textContent?.trim() ?? '';

    if (adresse) {
      return new Promise((résoudre) => {
        new maps.services.Geocoder().addressSearch(adresse, (résultat, statut) => {
          const trouvé = statut === maps.services.Status.OK ? résultat[0] : null;
          résoudre(trouvé ? { position: new maps.LatLng(Number(trouvé.y), Number(trouvé.x)), où: adresse } : null);
        });
      });
    }

    if (!lieu) return Promise.resolve(null);
    return new Promise((résoudre) => {
      const bornes = new maps.LatLngBounds(
        new maps.LatLng(SEOUL_SW.lat, SEOUL_SW.lng),
        new maps.LatLng(SEOUL_NE.lat, SEOUL_NE.lng)
      );
      new maps.services.Places().keywordSearch(
        lieu,
        (résultat, statut) => {
          const voulu = normaliser(lieu);
          const trouvé =
            statut === maps.services.Status.OK
              ? résultat.find((r) => {
                  const rendu = normaliser(r.place_name);
                  return rendu === voulu || rendu.includes(voulu) || voulu.includes(rendu);
                })
              : null;
          résoudre(
            trouvé
              ? { position: new maps.LatLng(Number(trouvé.y), Number(trouvé.x)), où: trouvé.road_address_name || trouvé.address_name || '' }
              : null
          );
        },
        { bounds: bornes }
      );
    });
  }

  /** La carte ne viendra pas : le dire, et ne pas laisser un cadre vide. */
  function abandonner(raison) {
    console.debug('[carte]', raison);
    conteneur.hidden = true;
    if (note) {
      note.textContent = 'La carte Kakao n’a pas pu se charger.';
      note.hidden = false;
    }
    if (compte) compte.textContent = '0';
  }

  async function initialiser() {
    chargement = true;
    try {
      maps = await chargerKakao(cle);
    } catch (e) {
      abandonner(e instanceof Error ? e.message : String(e));
      return;
    }

    carte = new maps.Map(conteneur, {
      center: new maps.LatLng(SEOUL.lat, SEOUL.lng),
      level: NIVEAU_VILLE,
    });
    infobulle = new maps.CustomOverlay({ content: '', xAnchor: 0.5, yAnchor: 1.2, zIndex: 2, clickable: true });
    maps.event.addListener(carte, 'click', () => infobulle.setMap(null));

    // Tous les lieux d'un coup, une réponse à la fois : chaque pin se pose
    // quand il arrive, et le cadrage suit le dernier.
    const àPlacer = cartes.filter((c) => c.dataset.termine !== 'oui');
    let restants = àPlacer.length;
    if (restants === 0) synchroniser();
    for (const article of àPlacer) {
      situer(article).then((réponse) => {
        if (réponse) épingler(article, réponse.position, réponse.où);
        else console.debug('[carte] lieu non placé :', article.querySelector('h3')?.textContent);
        if (--restants === 0) synchroniser();
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
      carte.relayout();
      synchroniser();
    }
  }

  bloc.addEventListener('toggle', àLOuverture);
  àLOuverture();

  return { synchroniser };
}
