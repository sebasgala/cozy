import { ConsultaInvalidaException } from './problems/problem-details.exceptions';

// Mayor valor que cabe en una columna integer de PostgreSQL
export const ID_MAXIMO = 2147483647;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Evita que un número enorme enviado por el cliente rompa la consulta (integer fuera de rango).
export function acotarEntero(valor: number): number {
  return Math.min(valor, ID_MAXIMO);
}

// Un id solo puede existir si cabe en la columna integer.
export function esIdPosible(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= ID_MAXIMO;
}

// Noches de la estancia [checkin, checkout). Si checkout no es posterior a checkin, 400.
export function calcularNoches(checkin: string, checkout: string): number {
  const noches = Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / MS_POR_DIA);
  if (!(noches >= 1)) {
    throw new ConsultaInvalidaException([{ name: 'checkout', reason: 'checkout debe ser posterior a checkin' }]);
  }
  return noches;
}

// Huéspedes que le tocan a cada habitación: el reparto es parejo (hacia arriba).
// Con una sola habitación son simplemente todos los adultos y todos los niños.
export function repartirHuespedes(guests: { number_of_adults: number; number_of_rooms: number; children?: number[] }) {
  const habitaciones = guests.number_of_rooms;
  const ninos = guests.children?.length ?? 0;
  return {
    habitaciones: acotarEntero(habitaciones),
    adultosPorHabitacion: acotarEntero(Math.ceil(guests.number_of_adults / habitaciones)),
    ninosPorHabitacion: acotarEntero(Math.ceil(ninos / habitaciones)),
  };
}

// El token de página es opaco para el cliente: contiene la posición (offset) de la siguiente página.
export function codificarPagina(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

export function decodificarPagina(page?: string): number {
  if (page === undefined || page === '') return 0;
  try {
    const { offset } = JSON.parse(Buffer.from(page, 'base64url').toString('utf8'));
    if (Number.isInteger(offset) && offset >= 0 && offset <= ID_MAXIMO) return offset;
  } catch {
    // cae al error de abajo
  }
  throw new ConsultaInvalidaException([{ name: 'page', reason: 'El token de página no es válido' }]);
}

export function urlAlojamiento(id: number): string {
  return `/api/v1/alojamientos/${id}`;
}
