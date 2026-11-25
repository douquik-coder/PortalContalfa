/* Portal Contalfa · Traduce al español los mensajes técnicos que vienen en inglés
   (del navegador, de Supabase, del lector de Excel o de errores de programación). */
(function (g) {
  'use strict';
  const R = [
    // red y sesión
    [/^TypeError:\s*/i, ''],
    [/Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|network error/gi, 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo'],
    [/The (user|operation) (aborted a request|was aborted)\.?|signal is aborted without reason|AbortError/gi, 'La operación se canceló'],
    [/(JWT|token) (is )?expired|invalid JWT|Invalid Refresh Token[^.]*/gi, 'Tu sesión venció. Vuelve a iniciar sesión'],
    [/Invalid login credentials/gi, 'Usuario o clave incorrectos'],
    [/Email not confirmed/gi, 'El usuario no está confirmado'],
    [/User already registered/gi, 'Ese usuario ya existe'],
    [/Password should be at least (\d+) characters\.?/gi, 'La clave debe tener al menos $1 caracteres'],
    [/User not found/gi, 'Usuario no encontrado'],
    [/new row violates row-level security policy( for table "?[\w.]+"?)?/gi, 'No tienes permiso para guardar esto (revisa que la herramienta esté activa para tu usuario)'],
    [/permission denied for (table|relation|schema|function) "?[\w.]+"?/gi, 'No tienes permiso para esta acción'],
    [/duplicate key value violates unique constraint "?[\w.]+"?/gi, 'Ya existe un registro igual'],
    [/violates foreign key constraint "?[\w.]+"?/gi, 'Falta un dato relacionado (registro inexistente)'],
    [/JSON object requested, multiple \(or no\) rows returned/gi, 'No se encontró el registro'],
    [/(Payload|Request Entity|request entity) too large|The object exceeded the maximum allowed size/gi, 'El archivo o los datos son demasiado grandes para guardarlos'],
    [/Invalid key:?\s*/gi, 'Nombre de archivo no válido: '],
    [/Object not found|not found/gi, 'No se encontró'],
    [/(Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/gi, 'El servidor no respondió bien; intenta de nuevo en un momento'],
    [/timed? ?out|timeout/gi, 'Se agotó el tiempo de espera'],
    [/Too Many Requests|rate limit(ed)?/gi, 'Demasiadas solicitudes seguidas; espera un momento'],
    // almacenamiento del navegador
    [/(QuotaExceededError|exceeded the quota|The quota has been exceeded)[^.]*\.?/gi, 'No hay espacio suficiente para guardar'],
    [/DataCloneError[^.]*\.?|could not be cloned\.?/gi, 'Estos datos no se pueden guardar así'],
    [/The user aborted a request|NotAllowedError[^.]*/gi, 'El navegador no dio permiso'],
    // lector de Excel (SheetJS) y archivos
    [/File is password-protected|Encrypted file missing password|password-protected/gi, 'El archivo está protegido con clave. Ábrelo en Excel, quita la clave y guárdalo de nuevo'],
    [/Unsupported file( type)?[^.]*|Unrecognized (file )?(type|format)[^.]*|Unsupported ZIP Compression method[^.]*/gi, 'Formato de archivo no compatible. Guárdalo en Excel como .xlsx e intenta de nuevo'],
    [/Corrupted zip[^.]*|Bad (compressed|uncompressed) size[^.]*|End of data reached[^.]*|invalid (zip|signature)[^.]*|Header Signature: Expected[^.]*|CFB[^.]*/gi, 'El archivo está dañado o no es un Excel válido. Ábrelo en Excel y guárdalo de nuevo'],
    [/Sheet not found:?\s*/gi, 'No se encontró la hoja: '],
    [/Cannot find file [^.]*/gi, 'No se encontró el archivo'],
    // errores de programación
    [/Cannot read propert(y|ies) of (undefined|null)( \(reading '([^']*)'\))?/gi, (m, a, b, c, d) => 'Faltan datos que la herramienta esperaba encontrar' + (d ? ' (campo «' + d + '»)' : '')],
    [/Cannot set propert(y|ies) of (undefined|null)[^.]*/gi, 'Faltan datos que la herramienta esperaba encontrar'],
    [/(\S+) is not a function/gi, 'Función no disponible ($1)'],
    [/(\S+) is not defined/gi, 'Falta un componente ($1)'],
    [/(\S+) is not iterable/gi, 'Los datos no tienen el formato esperado ($1)'],
    [/Unexpected token[^,.]*(,? in JSON at position \d+)?|is not valid JSON|Unexpected end of JSON input/gi, 'Los datos guardados no tienen el formato esperado'],
    [/Maximum call stack size exceeded/gi, 'El archivo es demasiado complejo para procesarlo'],
    [/out of memory/gi, 'No hay memoria suficiente en el navegador para este archivo'],
    [/Invalid (array|string) length/gi, 'Los datos son demasiado grandes'],
    [/Invalid Date/g, 'Fecha no válida'],
    [/Script error\.?/gi, 'Error inesperado en la herramienta']
  ];
  // Fragmentos en inglés que delatan un mensaje sin traducir (para el filtro de pantalla)
  const SMELL = /Failed to fetch|NetworkError|Load failed|expired|row-level security|permission denied|duplicate key|foreign key|rows returned|too large|Invalid key|not found|Server Error|Bad Gateway|Unavailable|timeout|timed out|Too Many Requests|Quota|DataCloneError|password-protected|Unsupported|Unrecognized|Corrupted zip|Bad (un)?compressed|End of data|Header Signature|Sheet not found|Cannot read propert|Cannot set propert|is not a function|is not defined|is not iterable|Unexpected token|valid JSON|end of JSON|call stack|out of memory|Invalid (array|string) length|Invalid Date|Script error|TypeError|ReferenceError|RangeError|SyntaxError/;
  function enEspanol(msg) {
    if (msg == null) return '';
    let s = typeof msg === 'string' ? msg : (msg.message || msg.error_description || msg.error || String(msg));
    if (!SMELL.test(s)) return s;
    s = s.replace(/\bUncaught\s+/g, '').replace(/\b(Type|Reference|Range|Syntax)?Error:\s*/g, '');
    for (const [re, to] of R) s = s.replace(re, to);
    return s;
  }
  g.enEspanol = enEspanol;
  g.enEspanol.huele = (s) => SMELL.test(String(s || ''));
})(window);
