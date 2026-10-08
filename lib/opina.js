// Preguntas de «Tu opinión». Para añadir una: nuevo objeto con id único (no lo cambies una vez publicada) y sus opciones.
// Solo preguntas neutrales: ninguna opción puede favorecer a un partido.
export const POLLS = [
  { id: "ir-a-votar", q: "¿Vas a ir a votar el 29 de noviembre?", opts: [
    ["seguro", "Sí, seguro"], ["probable", "Probablemente sí"], ["dudo", "Probablemente no"], ["no", "No voy a votar"], ["nopuedo", "No puedo votar"] ] },
  { id: "decidido", q: "¿Tienes decidido tu voto?", opts: [
    ["claro", "Sí, lo tengo claro"], ["dudo", "Dudo entre dos o más partidos"], ["nada", "Todavía no tengo ni idea"], ["final", "Lo decidiré el último día"] ] },
  { id: "tema", q: "¿Qué tema pesará más en tu voto?", opts: [
    ["vivienda", "Vivienda"], ["empleo", "Empleo y sueldos"], ["sanidad", "Sanidad"], ["educacion", "Educación"], ["pensiones", "Pensiones"],
    ["impuestos", "Impuestos"], ["inmigracion", "Inmigración"], ["territorial", "Modelo territorial"], ["clima", "Medio ambiente y clima"],
    ["corrupcion", "Corrupción"], ["otro", "Otro tema"] ] },
  { id: "informarse", q: "¿Por dónde te informas sobre política?", opts: [
    ["tv", "Televisión"], ["prensa", "Prensa (papel o digital)"], ["radio", "Radio o pódcast"], ["redes", "Redes sociales"],
    ["gente", "Hablando con gente"], ["programas", "Los programas de los partidos"] ] },
  { id: "programa", q: "¿Has leído alguna vez un programa electoral?", opts: [
    ["entero", "Sí, alguno entero"], ["partes", "Solo algunas partes"], ["resumen", "Solo resúmenes como los de esta web"], ["nunca", "Nunca"] ] },
  { id: "gobierno", q: "¿Qué tipo de gobierno prefieres?", opts: [
    ["uno", "De un solo partido"], ["coalicion", "De coalición entre varios"], ["igual", "Me da igual"], ["nose", "No lo sé"] ] },
];
export const findPoll = id => POLLS.find(p => p.id === id);
