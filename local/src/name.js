'use strict';
// El nombre del programa, en un solo lugar. Cambiarlo acá lo cambia en la consola, en el panel propio y en lo que
// la API dice de sí misma. Fuera de este archivo quedan tres cosas que no pueden leer una constante: "name" y
// "bin" de package.json, el archivo bin/sharpmd-local.js y los README.
module.exports = {
  NAME: 'SharpMD Local',      // como se le dice a una persona
  CMD: 'sharpmd-local',       // el comando, y lo que la API contesta en "app"
  HOME: '.sharpmd-local',     // su carpeta dentro de la del usuario
};
