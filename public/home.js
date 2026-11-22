import { $, pickerHtml } from './common.js';
import { openCreate } from './create.js';

$('#start').onclick = () => openCreate();
$('#xmas').onclick = () => openCreate({ themeId: 'grinch-or-elf' });
$('#picker').innerHTML = pickerHtml(null);
$('#picker').querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => openCreate({ themeId: b.dataset.theme })));
$('#morecharts').onclick = () => $('#picker').classList.remove('folded');
