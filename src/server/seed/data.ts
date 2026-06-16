/** Static demo data for "Rancho Vista Lechería" (Jerome, Idaho). */

import type { WorkerRole } from '../db/schema.js';

export const DEMO_ORG = {
  name: 'Rancho Vista Lechería',
  timezone: 'America/Boise',
  locale: 'es',
  herdSize: 2400,
};

export const DEMO_OWNER = {
  email: 'demo@establo.app',
  password: 'establo-demo-2026',
  name: 'Sarah Whitfield',
  role: 'owner' as const,
};

/**
 * hoursAgo → last_inbound_at (null = never messaged); daysEmployed → hired_at.
 * The consent/agreement mix is deliberate so the demo shows every state:
 *   María   ordeño; opted_in, agreement signed 380d ago (annual RENEWAL DUE),
 *           track completed + supervisor signed off
 *   José    alimentación; opted_in (imported), agreement on paper, track
 *           completed but NOT signed off (flagged)
 *   Ana     becerras; opted_in, agreement never signed — enrolling her shows
 *           the role wedge (calf-care + universal lessons, NOT milking)
 *   Carlos  salud del hato; OPTED OUT (texted BAJA) — all sends blocked
 *   Luz     ordeño; opted_in, agreement signed recently via WhatsApp —
 *           enrolling her shows the milking lesson set (contrast with Ana)
 *   Pedro   general; opted_in, mid-track, agreement SENT awaiting ACEPTO (try
 *           it in the simulator)
 *   Rosa    becerras; PENDING — enrolled but never messaged: "awaiting opt-in",
 *           drip skips her (text ALTA as her in the simulator to watch the
 *           disclosure + opt-in flow)
 */
export interface DemoWorker {
  name: string;
  phone: string;
  hoursAgo: number | null;
  daysEmployed: number;
  /** Job role for role-scoped onboarding (null = unassigned → universal only). */
  jobRole: WorkerRole | null;
  consent: 'pending' | 'opted_in' | 'opted_out';
  consentMethod: 'whatsapp_keyword' | 'paper_form' | 'imported' | null;
  consentDaysAgo: number | null;
  /** Cow care agreement signature (null = unsigned). */
  agreement: { method: 'whatsapp' | 'paper'; daysAgo: number; attestedBy?: string } | null;
  /** Agreement sent over WhatsApp, ACEPTO still pending. */
  agreementPending?: boolean;
}

export const DEMO_WORKERS: DemoWorker[] = [
  {
    name: 'María Guadalupe Ramírez', phone: '+12085550101', hoursAgo: 2, daysEmployed: 420,
    jobRole: 'ordeno',
    consent: 'opted_in', consentMethod: 'whatsapp_keyword', consentDaysAgo: 420,
    agreement: { method: 'whatsapp', daysAgo: 380 },
  },
  {
    name: 'José Luis Hernández', phone: '+12085550102', hoursAgo: 30, daysEmployed: 250,
    jobRole: 'alimentacion',
    consent: 'opted_in', consentMethod: 'imported', consentDaysAgo: 250,
    agreement: { method: 'paper', daysAgo: 200, attestedBy: 'Sarah Whitfield' },
  },
  {
    name: 'Ana Sofía Torres', phone: '+12085550103', hoursAgo: 3, daysEmployed: 150,
    jobRole: 'becerras',
    consent: 'opted_in', consentMethod: 'whatsapp_keyword', consentDaysAgo: 150,
    agreement: null,
  },
  {
    name: 'Carlos Mendoza Ríos', phone: '+12085550104', hoursAgo: 120, daysEmployed: 95,
    jobRole: 'salud_hato',
    consent: 'opted_out', consentMethod: 'whatsapp_keyword', consentDaysAgo: 5,
    agreement: null,
  },
  {
    name: 'Luz Elena Vargas', phone: '+12085550105', hoursAgo: 1, daysEmployed: 60,
    jobRole: 'ordeno',
    consent: 'opted_in', consentMethod: 'whatsapp_keyword', consentDaysAgo: 60,
    agreement: { method: 'whatsapp', daysAgo: 30 },
  },
  {
    name: 'Pedro Aguilar Sánchez', phone: '+12085550106', hoursAgo: 1, daysEmployed: 3,
    jobRole: 'general',
    consent: 'opted_in', consentMethod: 'whatsapp_keyword', consentDaysAgo: 3,
    agreement: null, agreementPending: true,
  },
  {
    name: 'Rosa Imelda Castillo', phone: '+12085550107', hoursAgo: null, daysEmployed: 1,
    jobRole: 'becerras',
    consent: 'pending', consentMethod: null, consentDaysAgo: null,
    agreement: null,
  },
];

/** Seed SOP documents: file in seed/sops/, display title, short key. */
export const DEMO_SOPS = [
  { key: 'ordeno', file: 'rutina-de-ordeno.md', title: 'Rutina de ordeño' },
  { key: 'becerras', file: 'cuidado-de-becerras.md', title: 'Cuidado de becerras recién nacidas' },
  { key: 'quimicos', file: 'seguridad-de-quimicos.md', title: 'Manejo y seguridad de químicos' },
  { key: 'manejo', file: 'manejo-bajo-estres.md', title: 'Manejo de animales de bajo estrés' },
  { key: 'cip', file: 'limpieza-sala-cip.md', title: 'Limpieza de la sala de ordeño (CIP)' },
  { key: 'mastitis', file: 'deteccion-y-manejo-de-mastitis.md', title: 'Detección y manejo de mastitis' },
] as const;

export type SopKey = (typeof DEMO_SOPS)[number]['key'];

export const DEMO_TRACK = {
  name: 'Inducción — Primeras 2 semanas',
  description:
    'Programa de bienvenida con entrega por rol: las lecciones universales ' +
    '(químicos, manejo de animales) llegan a todos; las de ordeño y lavado de ' +
    'sala solo a ordeñadores, y la de calostro solo a quienes cuidan becerras.',
};

export interface DemoModule {
  dayOffset: number;
  sendHourLocal: number;
  title: string;
  bodyEs: string;
  checkQuestionEs: string;
  checkOptionsEs: string[];
  checkCorrectIndex: number;
  sopKey: SopKey;
  /** FARM Animal Care v5 CE area — the manager sets this per module. */
  farmTopic:
    | 'stockmanship_general'
    | 'preweaned_calf'
    | 'non_ambulatory'
    | 'euthanasia'
    | 'fitness_to_transport'
    | 'safety_other'
    | 'none';
  /** Role targeting: [] (empty) = universal (every role gets it). */
  appliesToRoles: WorkerRole[];
}

export const DEMO_MODULES: DemoModule[] = [
  {
    dayOffset: 0,
    sendHourLocal: 7,
    title: 'Bienvenida y la rutina de ordeño',
    bodyEs:
      '¡Bienvenido al equipo! 🐄 En esta lechería el ordeño sigue siempre los mismos pasos, con cada vaca:\n' +
      '1) Ponte guantes de nitrilo limpios.\n' +
      '2) Aplica el pre-dip en cada pezón.\n' +
      '3) Haz el despunte: 3 a 4 chorros de leche por cuarto, mirando que la leche se vea normal.\n' +
      '4) Seca cada pezón con una toalla. Una toalla por vaca, nunca compartida.\n' +
      '5) Coloca la unidad de ordeño.\n' +
      '6) Al final, aplica el post-dip cubriendo todo el pezón.\n' +
      'Si ves leche con grumos, sangre o agua, separa la vaca y avisa al encargado.',
    checkQuestionEs: 'En el despunte, ¿cuántos chorros de leche sacas por cada cuarto?',
    checkOptionsEs: ['Solo 1 chorro', '3 a 4 chorros', '10 chorros o más'],
    checkCorrectIndex: 1,
    sopKey: 'ordeno',
    farmTopic: 'none',
    appliesToRoles: ['ordeno'],
  },
  {
    dayOffset: 1,
    sendHourLocal: 7,
    title: 'El pre-dip y sus 30 segundos',
    bodyEs:
      'El pre-dip es el desinfectante que se pone ANTES de ordeñar. Lo importante:\n' +
      '1) Cubre al menos 3/4 partes de cada pezón con la copa.\n' +
      '2) Déjalo trabajar 30 segundos. Ese tiempo es obligatorio: si lo quitas antes, no mata las bacterias.\n' +
      '3) Después seca muy bien cada pezón con su toalla.\n' +
      'Un pezón limpio y seco protege a la vaca de mastitis y mantiene la leche de calidad. Cuando hay prisa, los 30 segundos son lo primero que la gente se salta. No lo hagas: la prisa de hoy es una vaca enferma mañana.',
    checkQuestionEs: '¿Cuánto tiempo debe quedarse el pre-dip en el pezón antes de secar?',
    checkOptionsEs: ['5 segundos', '30 segundos', '5 minutos'],
    checkCorrectIndex: 1,
    sopKey: 'ordeno',
    farmTopic: 'none',
    appliesToRoles: ['ordeno'],
  },
  {
    dayOffset: 2,
    sendHourLocal: 7,
    title: 'Químicos: la regla que salva vidas',
    bodyEs:
      'En la lechería usamos cloro, ácidos y detergentes fuertes. Apréndete esto desde hoy:\n' +
      '1) NUNCA mezcles cloro con ácido. Esa mezcla suelta un gas tóxico que puede matar en un lugar cerrado.\n' +
      '2) Nunca vacíes un químico en un envase que tenía otro producto.\n' +
      '3) Para manejar químicos concentrados ponte: lentes, guantes verdes gruesos, mandil y botas.\n' +
      '4) Siempre agrega el químico al agua, nunca el agua al químico.\n' +
      '5) Si te cae químico en la piel o los ojos: enjuaga 15 minutos con agua y avisa al encargado.\n' +
      'Si hueles un gas que pica en la nariz: sal de ahí y avisa. Primero tú, después el trabajo.',
    checkQuestionEs: '¿Qué pasa si se mezcla cloro con ácido?',
    checkOptionsEs: ['Limpia mejor', 'No pasa nada', 'Se forma un gas tóxico muy peligroso'],
    checkCorrectIndex: 2,
    sopKey: 'quimicos',
    farmTopic: 'safety_other',
    appliesToRoles: [], // universal — chemical safety is for everyone
  },
  {
    dayOffset: 4,
    sendHourLocal: 7,
    title: 'Mover vacas sin estrés',
    bodyEs:
      'Una vaca tranquila camina sola. Así trabajamos aquí:\n' +
      '1) Prohibido usar chicharra eléctrica, gritar, golpear o correr a las vacas.\n' +
      '2) Las vacas caminan a su paso (3 a 4 km por hora). Tú caminas detrás, a ese mismo paso.\n' +
      '3) El punto de balance está en el hombro: párate detrás del hombro y la vaca avanza; delante del hombro y se detiene.\n' +
      '4) No te acerques derecho por atrás: la vaca no te ve. Acércate en ángulo, por un costado.\n' +
      '5) Si una vaca se resbala y queda echada, dale espacio y avisa al encargado. Nunca la jales.\n' +
      'Las auditorías de bienestar animal revisan esto. Tu calma protege a las vacas y al trabajo de todos.',
    checkQuestionEs: '¿Dónde está el punto de balance para mover una vaca?',
    checkOptionsEs: ['En el hombro', 'En la cola', 'En las orejas'],
    checkCorrectIndex: 0,
    sopKey: 'manejo',
    farmTopic: 'stockmanship_general',
    appliesToRoles: [], // universal — low-stress handling is for everyone
  },
  {
    dayOffset: 7,
    sendHourLocal: 7,
    title: 'Calostro: las primeras 2 horas',
    bodyEs:
      'El calostro es la primera leche de la vaca y es la única defensa de la becerra recién nacida.\n' +
      '1) Da 4 litros de calostro de buena calidad en las primeras 2 horas de vida.\n' +
      '2) La calidad se mide con el refractómetro: 22% Brix o más. Si marca menos, usa calostro del banco.\n' +
      '3) Después de las 6 horas, la tripa de la becerra ya casi no absorbe defensas. La rapidez lo es todo.\n' +
      '4) El ombligo se desinfecta con yodo al 7% en la primera hora, y otra vez a las 12 horas.\n' +
      'Si una becerra no quiere tomar, no la fuerces con sonda si no estás entrenado: busca a alguien que sí lo esté.',
    checkQuestionEs: '¿Cuánto calostro se da en las primeras 2 horas de vida?',
    checkOptionsEs: ['1 litro', '4 litros', 'El calostro no es importante'],
    checkCorrectIndex: 1,
    sopKey: 'becerras',
    farmTopic: 'preweaned_calf',
    appliesToRoles: ['becerras'],
  },
  {
    dayOffset: 10,
    sendHourLocal: 7,
    title: 'El lavado CIP de la sala',
    bodyEs:
      'Después de CADA ordeño, el sistema CIP lava por dentro las líneas y las unidades. Tu parte:\n' +
      '1) Conecta bien todas las unidades a las copas de lavado, sin fugas de aire.\n' +
      '2) El primer enjuague es con agua TIBIA (35 a 43 °C): despega la leche sin cocerla.\n' +
      '3) El lavado fuerte entra de 71 a 77 °C y no debe bajar de 49 °C al final. Si regresa fría, repórtalo.\n' +
      '4) Después viene el enjuague ácido. Recuerda: el cloro y el ácido nunca se tocan.\n' +
      '5) Anota las temperaturas en la bitácora en cada lavado.\n' +
      'Si hueles agrio en las unidades o ves residuo blanco en las mirillas, avisa el mismo día.',
    checkQuestionEs: '¿Por qué el primer enjuague del CIP es con agua tibia?',
    checkOptionsEs: [
      'Para gastar menos agua',
      'Porque despega la leche sin cocerla en las líneas',
      'Porque no hay agua caliente',
    ],
    checkCorrectIndex: 1,
    sopKey: 'cip',
    farmTopic: 'none',
    appliesToRoles: ['ordeno'],
  },
];

/** Pool of realistic historical Q&A interactions for the last 2 weeks. */
export interface DemoQa {
  question: string;
  answer: string;
  topic: string;
  sopKey: SopKey | null;
  heading: string;
  confidence: 'grounded' | 'partial' | 'not_found';
  voice?: boolean;
}

export const DEMO_QA_POOL: DemoQa[] = [
  {
    question: '¿Cuánto tiempo dejo el pre-dip en el pezón?',
    answer:
      'El pre-dip se queda 30 segundos en el pezón. Cubre al menos 3/4 partes del pezón con la copa, espera los 30 segundos y luego seca con una toalla limpia.\n\n📄 Fuente: Rutina de ordeño — Rutina de ordeño > Pre-dip (desinfección antes del ordeño)',
    topic: 'Ordeño',
    sopKey: 'ordeno',
    heading: 'Rutina de ordeño > Pre-dip (desinfección antes del ordeño)',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: '¿Cuántos chorros saco en el despunte?',
    answer:
      'Saca 3 a 4 chorros de leche por cada cuarto, sobre la taza de fondo oscuro. Fíjate si la leche tiene grumos, sangre o agua: si se ve rara, separa la vaca y avisa al encargado.\n\n📄 Fuente: Rutina de ordeño — Rutina de ordeño > Despunte (forestripping)',
    topic: 'Ordeño',
    sopKey: 'ordeno',
    heading: 'Rutina de ordeño > Despunte (forestripping)',
    confidence: 'grounded',
  },
  {
    question: '¿Puedo usar la misma toalla para dos vacas si están limpias?',
    answer:
      'No. La toalla es una por vaca, siempre. Compartir toalla pasa bacterias de una vaca a otra y puede causar mastitis. Seca bien la punta del pezón y tira la toalla usada.\n\n📄 Fuente: Rutina de ordeño — Rutina de ordeño > Secado',
    topic: 'Ordeño',
    sopKey: 'ordeno',
    heading: 'Rutina de ordeño > Secado',
    confidence: 'grounded',
  },
  {
    question: '¿A los cuántos segundos pongo la unidad?',
    answer:
      'Coloca la unidad entre 60 y 90 segundos después de empezar la estimulación (el pre-dip y el despunte). En ese tiempo la vaca baja la leche. Acomoda las pezoneras derechas, sin que entre aire.\n\n📄 Fuente: Rutina de ordeño — Rutina de ordeño > Colocación de la unidad',
    topic: 'Ordeño',
    sopKey: 'ordeno',
    heading: 'Rutina de ordeño > Colocación de la unidad',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: '¿Qué hago si la leche sale con grumos?',
    answer:
      'Separa la vaca y avisa al encargado. Esa leche NO va al tanque. Los grumos pueden ser mastitis, por eso el despunte se hace mirando la leche en la taza oscura.\n\n📄 Fuente: Rutina de ordeño — Rutina de ordeño > Despunte (forestripping)',
    topic: 'Salud animal',
    sopKey: 'ordeno',
    heading: 'Rutina de ordeño > Despunte (forestripping)',
    confidence: 'grounded',
  },
  {
    question: '¿Cuánto calostro le doy a una becerra recién nacida?',
    answer:
      'Da 4 litros de calostro de buena calidad (22% Brix o más) en las primeras 2 horas de vida. Si la becerra está pequeña, da 3 litros y avisa al encargado.\n\n📄 Fuente: Cuidado de becerras recién nacidas — Cuidado de becerras recién nacidas > Calostro: la comida más importante de su vida',
    topic: 'Cuidado de becerras',
    sopKey: 'becerras',
    heading: 'Cuidado de becerras recién nacidas > Calostro: la comida más importante de su vida',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: '¿Con qué se desinfecta el ombligo?',
    answer:
      'Con yodo al 7%, sumergiendo todo el ombligo en el vasito desechable. Se hace en la primera hora de vida y se repite a las 12 horas. Usa un vasito limpio por becerra.\n\n📄 Fuente: Cuidado de becerras recién nacidas — Cuidado de becerras recién nacidas > Desinfección del ombligo',
    topic: 'Cuidado de becerras',
    sopKey: 'becerras',
    heading: 'Cuidado de becerras recién nacidas > Desinfección del ombligo',
    confidence: 'grounded',
  },
  {
    question: '¿A qué temperatura caliento el calostro congelado?',
    answer:
      'Descongela en baño maría tibio a no más de 49 °C. Nunca uses agua hirviendo ni microondas a potencia alta porque el calor mata las defensas. Sírvelo a la becerra a 38–39 °C.\n\n📄 Fuente: Cuidado de becerras recién nacidas — Cuidado de becerras recién nacidas > Manejo del calostro almacenado',
    topic: 'Cuidado de becerras',
    sopKey: 'becerras',
    heading: 'Cuidado de becerras recién nacidas > Manejo del calostro almacenado',
    confidence: 'grounded',
  },
  {
    question: '¿Qué pasa si mezclo cloro con ácido?',
    answer:
      'NUNCA los mezcles. Esa mezcla suelta un gas tóxico (gas cloro) que puede matar en minutos en un lugar cerrado. Si hueles un gas que pica en la nariz o los ojos: sal del área, avisa a los demás y llama al encargado. Si no estás seguro, pregunta a tu supervisor antes de hacerlo.\n\n📄 Fuente: Manejo y seguridad de químicos — Manejo y seguridad de químicos > La regla más importante',
    topic: 'Químicos y seguridad',
    sopKey: 'quimicos',
    heading: 'Manejo y seguridad de químicos > La regla más importante',
    confidence: 'grounded',
  },
  {
    question: '¿Qué guantes uso para los químicos?',
    answer:
      'Para químicos concentrados usa los guantes verdes gruesos de nitrilo, no los guantes delgados de ordeño. También ponte lentes de seguridad, mandil y botas de hule. Si no estás seguro, pregunta a tu supervisor antes de hacerlo.\n\n📄 Fuente: Manejo y seguridad de químicos — Manejo y seguridad de químicos > Equipo de protección personal (EPP)',
    topic: 'Químicos y seguridad',
    sopKey: 'quimicos',
    heading: 'Manejo y seguridad de químicos > Equipo de protección personal (EPP)',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: 'Me cayó cloro en el brazo, ¿qué hago?',
    answer:
      'Enjuaga la piel con agua corriente durante 15 minutos, ya, en la estación lavaojos o la manguera más cercana. Avisa al encargado de inmediato. No te talles. Si no estás seguro, pregunta a tu supervisor antes de hacerlo.\n\n📄 Fuente: Manejo y seguridad de químicos — Manejo y seguridad de químicos > Equipo de protección personal (EPP)',
    topic: 'Químicos y seguridad',
    sopKey: 'quimicos',
    heading: 'Manejo y seguridad de químicos > Equipo de protección personal (EPP)',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: '¿El químico se echa al agua o el agua al químico?',
    answer:
      'Siempre agrega el químico al agua, nunca el agua al químico. Echar agua sobre el concentrado puede hacer que brinque y te salpique. Usa el vaso medidor y sigue la etiqueta del producto.\n\n📄 Fuente: Manejo y seguridad de químicos — Manejo y seguridad de químicos > Dilución correcta',
    topic: 'Químicos y seguridad',
    sopKey: 'quimicos',
    heading: 'Manejo y seguridad de químicos > Dilución correcta',
    confidence: 'grounded',
  },
  {
    question: '¿Se puede usar la chicharra para mover vacas?',
    answer:
      'No. La chicharra eléctrica está PROHIBIDA en esta lechería, con cualquier animal y en cualquier área. Mueve a las vacas con calma usando tu posición, la bandera o la sonaja. Las vacas caminan a su paso, tú caminas detrás a ese paso.\n\n📄 Fuente: Manejo de animales de bajo estrés — Manejo de animales de bajo estrés > Reglas que no se negocian',
    topic: 'Manejo de animales',
    sopKey: 'manejo',
    heading: 'Manejo de animales de bajo estrés > Reglas que no se negocian',
    confidence: 'grounded',
  },
  {
    question: '¿Qué hago con una vaca que se resbaló y no se para?',
    answer:
      'Dale espacio y tiempo, no la jales ni la asustes. Avisa de inmediato al encargado: hay equipo especial (camilla o tablero) para moverla. Nunca se arrastra del cuello ni de las patas. Mientras llega ayuda, dale sombra y agua si se puede.\n\n📄 Fuente: Manejo de animales de bajo estrés — Manejo de animales de bajo estrés > Vacas caídas (vaca que no se puede parar)',
    topic: 'Manejo de animales',
    sopKey: 'manejo',
    heading: 'Manejo de animales de bajo estrés > Vacas caídas (vaca que no se puede parar)',
    confidence: 'grounded',
    voice: true,
  },
  {
    question: '¿A qué temperatura va el primer enjuague del lavado?',
    answer:
      'El primer enjuague va con agua tibia, entre 35 y 43 °C. Tibia despega la leche: la fría endurece la grasa y la muy caliente pega la proteína al acero. Esa agua se va al drenaje, no recircula.\n\n📄 Fuente: Limpieza de la sala de ordeño (CIP) — Limpieza de la sala de ordeño (CIP) > Ciclo 1 — Enjuague inicial (agua tibia)',
    topic: 'Higiene',
    sopKey: 'cip',
    heading: 'Limpieza de la sala de ordeño (CIP) > Ciclo 1 — Enjuague inicial (agua tibia)',
    confidence: 'grounded',
  },
  {
    question: '¿Cuántos minutos circula el lavado fuerte?',
    answer:
      'El lavado alcalino clorado circula entre 8 y 10 minutos. Entra de 71 a 77 °C y al final no debe bajar de 49 °C. Si el agua regresa más fría, repórtalo al encargado.\n\n📄 Fuente: Limpieza de la sala de ordeño (CIP) — Limpieza de la sala de ordeño (CIP) > Ciclo 2 — Lavado alcalino clorado (el lavado fuerte)',
    topic: 'Higiene',
    sopKey: 'cip',
    heading: 'Limpieza de la sala de ordeño (CIP) > Ciclo 2 — Lavado alcalino clorado (el lavado fuerte)',
    confidence: 'grounded',
  },
  {
    question: '¿Cada cuándo se cambia el filtro de leche?',
    answer: '',
    topic: 'Equipo y mantenimiento',
    sopKey: null,
    heading: '',
    confidence: 'not_found',
  },
  {
    question: '¿Cuál es la dosis de penicilina para una vaca con fiebre?',
    answer: '',
    topic: 'Salud animal',
    sopKey: null,
    heading: '',
    confidence: 'not_found',
    voice: true,
  },
  {
    question: '¿Qué hago si la bomba de vacío hace un ruido raro?',
    answer: '',
    topic: 'Equipo y mantenimiento',
    sopKey: null,
    heading: '',
    confidence: 'not_found',
  },
];
