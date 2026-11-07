// Keys pressed inside a page go to the page, so it tells Progress about
// Escape itself, unless one of its own handlers has used the key. The server
// allows this script by its hash on a page that runs no scripts of its own.
export const PAGE_ESCAPE_MESSAGE = "progress:page-escape";
export const PAGE_ESCAPE_SCRIPT = `addEventListener("keydown",function(e){if(e.key==="Escape"&&!e.defaultPrevented)parent.postMessage("${PAGE_ESCAPE_MESSAGE}","*")})`;
