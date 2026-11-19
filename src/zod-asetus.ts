// Zodin nopeutuskoe (new Function) näkyisi tiukan CSP:n (script-src 'self') alla rikkeenä konsolissa, vaikka virhe
// otetaan kiinni. Koe tehdään jo skeeman luonnissa, joten asetus tuodaan domain/model.ts:ssä: jokainen skeemamoduuli
// tuo sen ennen omia skeemojaan. Tarkistus toimii samoin ilman koetta.
import { z } from "zod";
z.config({ jitless: true });
