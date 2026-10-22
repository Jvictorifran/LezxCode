// Teste de fumaça usado no CI (LEZX_EVAL): abre um arquivo, o terminal e registra o resultado no log
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const log = m => console.log('SMOKE ' + m);
  window.addEventListener('error', e => log('ERRO ' + e.message));
  await wait(1500);
  log('raiz: ' + document.querySelector('#explorer-title')?.textContent);
  log('arquivos: ' + [...document.querySelectorAll('#tree .row')].map(r => r.textContent.trim()).join(', '));
  document.querySelector('.row[data-path$="index.html"]')?.click();
  await wait(1500);
  log('aba ativa: ' + document.querySelector('.tab.active')?.textContent.trim());
  log('caminho da aba: ' + document.querySelector('.tab.active')?.title);
  document.querySelector('#term-new').click();
  await wait(6000);
  log('terminal: ' + JSON.stringify(document.querySelector('.xterm-rows')?.textContent.trim().slice(0, 120)));
  log('atalho na boas-vindas: ' + [...document.querySelectorAll('.shortcuts kbd')].slice(0, 2).map(k => k.textContent).join(' | '));
  log('linguagem: ' + document.querySelector('#sb-lang')?.textContent);
})();
