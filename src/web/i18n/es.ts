import type { Dictionary } from './en';

/**
 * Spanish (Latin American) dictionary for the manager dashboard.
 *
 * Register: professional but plain — the manager-side counterpart of the
 * worker-facing services/messages.es.ts. Typed as `Dictionary`, so a missing
 * or extra key (vs. en.ts) is a compile error.
 *
 * Terms flagged `REVIEW (native speaker)` are industry- or product-specific
 * choices that deserve a check by a native Spanish speaker working in US
 * dairy operations before this ships wide.
 */
export const es: Dictionary = {
  common: {
    loading: 'Cargando…',
    working: 'Procesando…',
    cancel: 'Cancelar',
    save: 'Guardar',
    saved: 'Guardado',
    delete: 'Eliminar',
    edit: 'Editar',
    retry: 'Reintentar',
    close: 'Cerrar',
    on: 'Activado',
    off: 'Desactivado',
  },

  dates: {
    never: 'nunca',
    justNow: 'ahora mismo',
    minutesAgo: (n: number) => `hace ${n} min`,
    hoursAgo: (n: number) => `hace ${n} h`,
    daysAgo: (n: number) => `hace ${n} d`,
  },

  themeToggle: {
    switchToLight: 'Cambiar a modo claro',
    switchToDark: 'Cambiar a modo oscuro',
  },

  localeToggle: {
    switchTo: (language: string) => `Cambiar el idioma del panel a ${language}`,
    english: 'inglés',
    spanish: 'español',
    saveFailed: 'No se pudo guardar tu preferencia de idioma',
  },

  nav: {
    overview: 'Resumen',
    // REVIEW (native speaker): "SOPs" is kept as-is — US dairies commonly say
    // "SOPs" even in Spanish; "POEs" (procedimientos operativos estándar) is
    // the formal alternative.
    sops: 'SOPs',
    workers: 'Trabajadores',
    // REVIEW (native speaker): "Inducción" for onboarding (matches the seeded
    // track name "Inducción — Primeras 2 semanas"); "Incorporación" is an
    // alternative.
    onboarding: 'Inducción',
    conversations: 'Conversaciones',
    audit: 'Auditoría y exportaciones',
    settings: 'Configuración',
    simulator: 'Simulador',
    mockTag: 'mock',
  },

  layout: {
    loadingApp: 'Cargando Establo…',
    signOut: 'Cerrar sesión',
    templateAlert: {
      body: 'La entrega de plantillas de WhatsApp está fallando — posible cambio de categoría; las lecciones programadas están pausadas para los trabajadores afectados.',
      since: 'desde',
      // The RUNBOOK itself is an English operations document, so the section
      // name stays in English on purpose.
      seeRunbook: 'Consulta la sección "Template failure banner" del RUNBOOK.',
      resuming: 'Reanudando…',
      acknowledge: 'Confirmar y reanudar',
    },
    demoBanner: {
      title: 'Demo alojado',
      body: '— lechería de muestra, los datos se reinician al recargar. Las respuestas aquí son extractos literales de los SOPs; el sistema completo responde con Claude, notas de voz y WhatsApp real.',
      cta: 'Corre el sistema real',
    },
  },

  // REVIEW (native speaker): one badge label serves several nouns of mixed
  // grammatical gender (trabajador m., inscripción f., documento m.,
  // escalamiento m.). Masculine forms are used throughout as the least-bad
  // compromise; if agreement matters more than reuse, the badge needs a
  // per-noun label instead.
  status: {
    ready: 'listo',
    processing: 'procesando',
    uploaded: 'subido',
    failed: 'falló',
    active: 'activo',
    inactive: 'inactivo',
    completed: 'completado',
    paused: 'pausado',
    open: 'abierto',
    resolved: 'resuelto',
    pending: 'pendiente',
    notified: 'notificado',
    sent: 'enviado',
    answered: 'respondido',
  },

  consent: {
    // REVIEW (native speaker): consent states are phrased with alta/baja to
    // match the ALTA/BAJA WhatsApp keywords the workers actually text.
    optedIn: 'dado de alta',
    pending: 'esperando alta',
    optedOut: 'dado de baja',
    methods: {
      whatsapp_keyword: 'palabra clave de WhatsApp',
      paper_form: 'formulario en papel',
      imported: 'importado',
    },
  },

  roles: {
    ordeno: 'Ordeño',
    becerras: 'Cuidado de becerras',
    alimentacion: 'Alimentación',
    salud_hato: 'Salud del hato',
    general: 'General / todos los puestos',
  },

  rolesShort: {
    ordeno: 'Ordeño',
    becerras: 'Becerras',
    alimentacion: 'Alimentación',
    salud_hato: 'Salud del hato',
    general: 'General',
  },

  farm: {
    // FARM program area names: the program itself is English-only, so the
    // Spanish labels describe the area while keeping "FARM" as a proper noun.
    // REVIEW (native speaker): "stockmanship" has no standard Spanish
    // equivalent; kept in parentheses.
    options: {
      none: 'No específico de FARM',
      stockmanship_general: 'Cuidado y manejo general del ganado (stockmanship)',
      preweaned_calf: 'Cuidado de becerras lactantes',
      non_ambulatory: 'Manejo de animales caídos (no ambulatorios)',
      euthanasia: 'Eutanasia',
      fitness_to_transport: 'Aptitud para el transporte',
      safety_other: 'Seguridad del trabajador / otro',
    },
    short: {
      stockmanship_general: 'FARM: manejo de ganado',
      preweaned_calf: 'FARM: becerras',
      non_ambulatory: 'FARM: animales caídos',
      euthanasia: 'FARM: eutanasia',
      fitness_to_transport: 'FARM: transporte',
      safety_other: 'seguridad',
    },
  },

  events: {
    qa_interaction: 'Pregunta y respuesta',
    module_delivered: 'Módulo entregado',
    // REVIEW (native speaker): "comprobación" for the one-question
    // comprehension check ("pregunta rápida" on the worker side).
    check_passed: 'Comprobación acertada',
    check_failed: 'Comprobación fallada',
    // REVIEW (native speaker): "escalamiento" (LatAm) for escalation; also
    // used across the Conversations and Settings pages.
    escalation: 'Escalado',
  },

  login: {
    tagline: 'Capacitación y consulta de SOPs por WhatsApp para tu lechería',
    signIn: 'Iniciar sesión',
    setUpDairy: 'Registrar una lechería',
    orgName: 'Nombre de la lechería / organización',
    timezone: 'Zona horaria',
    yourName: 'Tu nombre',
    // REVIEW (native speaker): "token" kept as-is (technical credential).
    setupToken: 'Token de configuración',
    setupTokenPlaceholder: 'Te lo da tu contacto de Establo',
    email: 'Correo electrónico',
    password: 'Contraseña',
    createDairy: 'Crear lechería + cuenta de propietario',
    demoPrefix: 'Demo:',
  },

  overview: {
    title: 'Resumen',
    subtitle: 'Actividad de capacitación y cumplimiento en tu lechería.',
    activeWorkers: 'Trabajadores activos',
    questionsThisWeek: 'Preguntas esta semana',
    modulesDelivered7d: 'Módulos entregados (7 días)',
    // REVIEW (native speaker): "vacíos de conocimiento" for knowledge gaps.
    openKnowledgeGaps: 'Vacíos de conocimiento abiertos',
    deletionNoticesTitle: 'Avisos de eliminación de datos',
    deletionBeforeDate:
      'Se eliminó permanentemente el registro de 1 trabajador a petición suya el',
    deletionAfterDate:
      '. Sus conteos de capacitación salieron de los registros; a propósito no se guarda quién lo pidió.',
    activityTitle: 'Actividad de capacitación — últimos 14 días',
    eventsCount: (n: number) => `${n} eventos`,
    recentEscalations: 'Escalamientos recientes',
    viewAll: 'Ver todos',
    noOpenEscalations: 'No hay escalamientos abiertos.',
  },

  sops: {
    title: 'SOPs',
    subtitle:
      'Sube tus procedimientos (PDF, Word o fotos de SOPs en papel). Establo responde a los trabajadores solo con base en estos.',
    demoNote: (count: string) =>
      `La carga de documentos y el OCR corren en el backend real — este demo alojado incluye los ${count}SOPs de muestra de abajo (revisa sus fragmentos extraídos con "Ver texto"). Clona el repositorio y ejecuta`,
    demoNoteAfterCode: 'para ingerir los tuyos.',
    dropHere: 'Arrastra y suelta archivos aquí, o',
    browse: 'búscalos',
    fileTypes: 'PDF · DOCX · Markdown · fotos JPG/PNG',
    asPages:
      'Las imágenes seleccionadas son páginas de UN solo documento (SOP en papel fotografiado)',
    uploading: 'Subiendo…',
    confirmDelete: (title: string) =>
      `¿Eliminar "${title}" y todos sus fragmentos? Los trabajadores ya no recibirán respuestas basadas en él.`,
    emptyTitle: 'Aún no hay SOPs',
    emptyHint: 'Sube tu primer procedimiento arriba — o ejecuta pnpm seed para datos de muestra.',
    colDocument: 'Documento',
    colStatus: 'Estado',
    // REVIEW (native speaker): "fragmentos" for retrieval chunks.
    colChunks: 'Fragmentos',
    colUploaded: 'Subido',
    viewText: 'Ver texto',
    chunksExtracted: 'fragmentos — texto extraído tal como Establo lo consulta',
    tokensApprox: (n: number) => `· ~${n} tokens`,
  },

  workers: {
    title: 'Trabajadores',
    subtitle: 'Todas las personas que pueden mandar textos o notas de voz a Establo',
    printConsentForm: 'Imprimir formulario de consentimiento',
    addWorker: '+ Agregar trabajador',
    filterAll: 'Todos los estados de alta',
    filterOptedIn: 'Dados de alta',
    filterPending: 'Esperando alta',
    filterOptedOut: 'Dados de baja',
    countOf: (visible: number, total: number) => `${visible} de ${total} trabajadores`,
    colName: 'Nombre',
    colPhone: 'Teléfono',
    colRole: 'Puesto',
    colConsent: 'Consentimiento',
    colAgreement: 'Acuerdo',
    colOnboarding: 'Inducción',
    colLastActive: 'Última actividad',
    unsigned: 'sin firmar',
    renewalDue: 'renovación pendiente',
    unassigned: 'sin asignar',
    modulesCount: 'módulos',
    lessonsWaitOptIn: '— las lecciones esperan el alta',
    emptyTitle: 'Aún no hay trabajadores',
    emptyHint: 'Agrega un trabajador con su número de WhatsApp para empezar.',
    noFilterMatch: 'Ningún trabajador coincide con este filtro.',
    addTitle: 'Agregar trabajador',
    fullName: 'Nombre completo',
    phoneLabel: 'Teléfono de WhatsApp (E.164)',
    jobRoleLabel: 'Puesto (define qué lecciones específicas de puesto recibe)',
    unassignedOption: 'Sin asignar (solo lecciones universales)',
    notesLabel: 'Notas (opcional)',
    optInNote1: 'Agregar a un trabajador',
    optInNoteNot: 'no',
    optInNote2:
      'lo da de alta. Se da de alta él mismo al escribir al número (ALTA o cualquier primer mensaje), o firma el formulario de consentimiento impreso y tú dejas constancia en su registro. Hasta entonces, Establo no le manda nada.',
    adding: 'Agregando…',
  },

  workerDetail: {
    hired: 'contratado',
    lastActive: 'última actividad',
    downloadTranscript: 'Descargar historial (PDF)',
    deleteData: 'Eliminar datos del trabajador',
    enrollInTrack: 'Inscribir en un programa',
    deletedBefore: 'Los datos de este trabajador se eliminaron permanentemente el',
    deletedAfter:
      '. El nombre, el teléfono y el contenido de los mensajes ya no existen; lo que queda abajo son registros de capacitación sin datos personales (tema, resultados de comprobación, fechas).',
    agreementSentNote: 'Acuerdo enviado — el trabajador firma respondiendo ACEPTO.',
    agreementQueuedNote:
      'Acuerdo en cola — sale la próxima vez que el trabajador escriba (la ventana de 24h está cerrada).',
    jobRoleTitle: 'Puesto',
    jobRoleHint: 'Define qué lecciones específicas de puesto recibe este trabajador al inscribirse.',
    voiceTitle: 'Siempre enviar notas de voz',
    voiceHint:
      'Adjunta una nota de voz hablada a cada respuesta y a cada comprobación — no solo cuando este trabajador manda audio. Las lecciones siempre incluyen audio.',
    consentTitle: 'Consentimiento de WhatsApp',
    // REVIEW (native speaker): "constancia" for the manager's attestation.
    attestedBy: (name: string) => `constancia de ${name}`,
    consentPendingHint:
      'Establo no manda nada hasta que este trabajador se dé de alta: él escribe al número (ALTA o cualquier primer mensaje), o tú recoges el formulario impreso y dejas constancia aquí.',
    consentPaperButton: 'Consentimiento recogido en papel',
    optedOutNote:
      'Este trabajador escribió BAJA. Todos los envíos están bloqueados hasta que él mismo escriba ALTA — esto no se puede anular desde el panel.',
    agreementTitle: 'Acuerdo de cuidado de las vacas',
    signed: 'Firmado',
    on: 'el',
    via: 'por',
    annualRenewalDue: 'renovación anual pendiente',
    sentPending: 'Enviado',
    awaitingAcepto: '— esperando que el trabajador responda',
    notSigned: 'Sin firmar',
    sendForResignature: 'Enviar para nueva firma',
    sendViaWhatsapp: 'Enviar por WhatsApp',
    mustOptInFirst: 'El trabajador debe darse de alta primero',
    markSignedPaper: 'Marcar firmado en papel',
    farmAgreementNote:
      'FARM Animal Care v5 espera un acuerdo de cuidado de las vacas firmado por cada empleado con responsabilidades de cuidado animal, renovado cada año.',
    confirmedBy: (name: string, role: string) => `Confirmado por ${name} (${role}) el`,
    completionNotConfirmed: 'finalización sin confirmar',
    started: 'inició',
    confirmCompletion: 'Confirmar finalización',
    certificatePdf: 'Certificado PDF',
    checkPassed: 'acertada',
    checkMissed: 'fallada',
    due: (when: string) => `programado ${when}`,
    awaitingOptInNote:
      'Esperando el alta — las lecciones están programadas pero no se envía nada hasta que este trabajador se dé de alta en WhatsApp.',
    transcriptTitle: 'Historial de capacitación',
    transcriptSubtitle: '— cada evento registrado, el más reciente primero',
    noEvents: 'Aún no hay eventos de capacitación.',
    deleteTitle: 'Eliminar datos del trabajador',
    deleteBody1: 'Esto elimina permanentemente el nombre, el teléfono y todo el contenido de mensajes de',
    deleteBody2:
      ', exactamente como si hubiera escrito BORRAR MIS DATOS. Los eventos de capacitación conservan solo sus campos de documentación sin datos personales (tema, resultados de comprobación, fechas), y el trabajador queda fuera de todas las exportaciones de auditoría futuras. Esto no se puede deshacer.',
    permanentlyDelete: 'Eliminar permanentemente',
    enrollTitle: (name: string) => `Inscribir a ${name}`,
    trackLabel: 'Programa de inducción',
    chooseTrack: 'Elige un programa…',
    trackOption: (name: string, count: number) => `${name} (${count} módulos)`,
    previewWorker: 'Este trabajador',
    previewRole: 'puesto:',
    previewUnassigned: '(sin asignar)',
    previewReceive: 'recibirá',
    previewOf: (applicable: number, total: number) => `${applicable} de ${total}`,
    previewLessons: 'lecciones según su puesto.',
    previewNoneApply:
      'Ninguna lección de este programa aplica a este puesto — asigna otro puesto o elige otro programa.',
    scheduleNote:
      'Los módulos se programan a partir de hoy usando el desfase de días de cada módulo, y el programador los envía a la hora local configurada.',
    notOptedInNote: 'Este trabajador aún no se da de alta — no se envía nada hasta que lo haga.',
    enroll: 'Inscribir',
    attestConsentTitle: 'Consentimiento recogido en papel',
    attestAgreementTitle: 'Acuerdo firmado en papel',
    attestConsentBody: (name: string) =>
      `Confirma que ${name} firmó el formulario impreso de consentimiento de WhatsApp. Guarda el formulario en su expediente.`,
    attestAgreementBody: (name: string) =>
      `Confirma que ${name} firmó el acuerdo de cuidado de las vacas en papel. Guarda la copia firmada en su expediente.`,
    attestNameLabel: 'Tu nombre completo (constancia)',
    attest: 'Dejar constancia',
  },

  onboarding: {
    title: 'Inducción',
    subtitle:
      'Programas de capacitación enviados por WhatsApp según calendario, con comprobaciones de una pregunta',
    newTrack: '+ Nuevo programa',
    emptyTitle: 'Aún no hay programas',
    emptyHint: 'Crea un programa y luego agrega o genera módulos desde un SOP.',
    modules: 'módulos',
    inProgress: 'en curso',
    completed: 'completados',
    modalTitle: 'Nuevo programa de inducción',
    nameLabel: 'Nombre',
    descriptionLabel: 'Descripción (opcional)',
    createTrack: 'Crear programa',
  },

  trackEditor: {
    generateFromSop: 'Generar desde un SOP',
    addModule: '+ Agregar módulo',
    dayAt: (day: number, hour: number) => `día ${day} · ${hour}:00 hora local`,
    allRoles: 'Todos los puestos',
    videoTag: 'video',
    checkLabel: 'Comprobación:',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    emptyNote: 'Aún no hay módulos — agrega uno a mano o genera borradores desde un SOP.',
    confirmDeleteModule: (title: string) => `¿Eliminar el módulo "${title}"?`,
    editTitle: 'Editar módulo',
    addTitle: 'Agregar módulo',
    titleLabel: 'Título',
    dayOffsetLabel: 'Desfase (días después de la inscripción)',
    sendHourLabel: 'Hora de envío (hora local de la organización)',
    farmAreaLabel:
      'Área de FARM Animal Care v5 (agrupa esta lección en el paquete de auditoría)',
    rolesLabel:
      'Se entrega a estos puestos — deja todo sin marcar para "Todos los puestos (universal)"',
    universalNote: 'Universal — todos los trabajadores inscritos reciben esta lección.',
    onlyRolesNote: (list: string) =>
      `Solo la reciben los trabajadores con estos puestos: ${list}.`,
    videoSectionLabel:
      'Video opcional — un enlace que enviamos e incrustamos (nunca se sube, aloja ni recorta)',
    chooseFromLibrary: 'Elige de la biblioteca de capacitación… (o pega un enlace abajo)',
    videoUrlPlaceholder: 'https://www.youtube.com/watch?v=…  (YouTube, Vimeo o cualquier enlace https)',
    invalidVideoLink: 'No es un enlace de video https válido.',
    videoTitleLabel: 'Título del video (en español, se muestra al trabajador)',
    videoTitleFallback: 'Título del video',
    availableLanguages: 'Idiomas disponibles',
    attributionLabel: 'Crédito del video',
    attributionHint:
      'Crédito obligatorio — se muestra al trabajador y queda en el registro de capacitación.',
    videoPreview: 'Vista previa del video',
    linkNoPreview: 'El enlace se enviará al trabajador (sin vista previa para este proveedor).',
    bodyLabel:
      'Cuerpo de la lección (en español, ≤900 caracteres, escrito para baja alfabetización) —',
    checkQuestionLabel: 'Pregunta de comprobación (en español)',
    optionLabel: (n: number) => `Opción ${n}`,
    correct: 'correcta',
    saveModule: 'Guardar módulo',
    generateTitle: 'Generar módulos desde un SOP',
    generateBody:
      'Claude redacta 3 módulos (lección + comprobación de comprensión) a partir del documento seleccionado. Revísalos y edítalos antes de inscribir a nadie — tú tienes el control.',
    sourceSop: 'SOP de origen',
    chooseDocument: 'Elige un documento…',
    drafting: 'Redactando… (toma ~20 s)',
    generateDrafts: 'Generar borradores',
  },

  conversations: {
    title: 'Conversaciones',
    subtitle:
      'Vista de solo lectura de los chats de los trabajadores, más la bandeja de escalamientos',
    tabConversations: 'Conversaciones',
    tabEscalations: 'Escalamientos',
    noConversations: 'Aún no hay conversaciones',
    pickConversation: 'Elige una conversación',
    messagesCount: (n: number) => `${n} mensajes`,
    voiceNote: 'nota de voz (transcrita)',
    template: 'plantilla',
    demoVoicePill: 'respuesta de voz — silenciada en este demo (el sistema real envía audio TTS)',
    colWorker: 'Trabajador',
    colQuestion: 'Pregunta',
    colReason: 'Motivo',
    colRaised: 'Creado',
    colStatus: 'Estado',
    markResolved: 'Marcar resuelto',
    noEscalationsTitle: 'No hay escalamientos',
    noEscalationsHint: 'Cuando Establo no puede responder con tus SOPs, el vacío aparece aquí.',
  },

  audit: {
    title: 'Auditoría y exportaciones',
    subtitle:
      'Un clic produce el paquete de documentación para una evaluación FARM o una investigación',
    // REVIEW (native speaker): "paquete de auditoría" for audit pack.
    generateTitle: 'Generar un paquete de auditoría',
    from: 'Desde',
    to: 'Hasta',
    starting: 'Iniciando…',
    generate: 'Generar paquete de auditoría',
    // Deliberately notes that the pack itself is in English: it is consumed
    // by English-speaking FARM evaluators and never translated.
    packContains:
      'El paquete contiene: una carta formal de documentación de capacitación (PDF, en inglés — la usan los evaluadores FARM) con cada empleado, sus fechas de capacitación, temas y resultados de comprobación · el CSV completo de eventos de capacitación · historiales PDF por trabajador — todo en un zip.',
    demoNote:
      'Demo alojado: el CSV se genera aquí mismo en tu navegador; la carta PDF y el zip de historiales los produce el backend real (córrelo localmente para verlos).',
    colPeriod: 'Periodo',
    colRequested: 'Solicitado',
    colStatus: 'Estado',
    colDownloads: 'Descargas',
    letterPdf: 'Carta PDF',
    csv: 'CSV',
    fullPack: 'Paquete completo (zip)',
    pdfBackendOnly: 'PDF/zip: solo backend',
    emptyTitle: 'Aún no hay paquetes de auditoría',
    emptyHint: 'Genera el primero arriba.',
  },

  settings: {
    title: 'Configuración',
    subtitle: 'Datos de la organización y facturación',
    orgTitle: 'Organización',
    dairyName: 'Nombre de la lechería',
    timezoneLabel: 'Zona horaria (el calendario de lecciones la usa)',
    herdSizeLabel: 'Tamaño del hato (vacas)',
    runModeTitle: 'Modo de ejecución',
    runModeBefore: 'Este servidor está corriendo en modo',
    runModeAfter: '. Consulta el README para el camino de mock a sandbox a producción.',
    // REVIEW (native speaker): "escalamiento forzoso" for forced escalation.
    keywordsTitle: 'Palabras clave de escalamiento forzoso',
    keywordsHint:
      'Una palabra clave por línea. Cualquier pregunta de un trabajador que contenga una de estas palabras (no importan acentos ni mayúsculas) se responde normalmente pero siempre se te marca como escalamiento — útil para químicos, equipos o temas de los que quieres enterarte personalmente.',
    saveKeywords: 'Guardar palabras clave',
    agreementTitle: 'Acuerdo de cuidado de las vacas',
    agreementHint:
      'FARM Animal Care v5 espera que cada empleado con responsabilidades de cuidado animal lo firme, con renovación anual. Los trabajadores firman respondiendo ACEPTO en WhatsApp. Editar el texto crea una versión nueva; las firmas existentes conservan su versión. Versión actual desde',
    saveNewVersion: 'Guardar como versión nueva',
    billingTitle: 'Facturación',
    subscription: 'Suscripción',
    subscriptionActiveTail: '— tarifa base + precio por vaca.',
    activeBadge: 'activa',
    noSubscription1:
      'No hay suscripción activa. Establo cobra una tarifa base fija más un monto por vaca (tu hato:',
    noSubscription2: 'vacas).',
    setupStripe: 'Configurar facturación con Stripe',
  },

  simulator: {
    title: 'Simulador de WhatsApp',
    subtitle: 'Actúa como un trabajador. Los mensajes pasan por el mismo flujo real del webhook.',
    mockBadge: 'modo mock',
    actingAs: 'Actuando como trabajador',
    windowLabel: 'Ventana de 24h:',
    windowOpen: 'ABIERTA',
    windowClosed: 'CERRADA',
    lastInbound: '— último mensaje recibido',
    consentLabel: 'Consentimiento:',
    agreementAwaiting: 'acuerdo esperando ACEPTO',
    // REVIEW (native speaker): "programador" for the drip scheduler.
    schedulerControls: 'Controles del programador',
    runDrip: 'Ejecutar el programador ahora',
    closeWindow: 'Simular >24h desde el último mensaje',
    dripRan: (delivered: number, notified: number, reminded: number) =>
      `El programador corrió: ${delivered} entregados, ${notified} notificados, ${reminded} recordados`,
    windowClosedNote:
      'Simulando que el trabajador escribió hace >24h — el próximo envío usa el saludo por plantilla',
    handshakeHint:
      'Inscribe a este trabajador en un programa (página Trabajadores), cierra la ventana y ejecuta el programador para ver el saludo por plantilla: llega la plantilla de aviso, el trabajador responde OK y llega la lección completa.',
    nonSpanishHint:
      'El asistente del trabajador opera en español — acaba de responder con un recordatorio corto de solo-español. Prueba una pregunta sugerida debajo del chat (o escribe en español).',
    sendMessage: 'Enviar mensaje',
    tryHint:
      'Toca una pregunta de arriba, o prueba: "¿me puedes subir el sueldo?" (rechazo) · "hola" · con una lección pendiente responde "2" · consentimiento "ALTA" / "BAJA" · con un acuerdo pendiente responde "ACEPTO".',
  },
};
