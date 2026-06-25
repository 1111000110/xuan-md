// 引擎渲染逻辑的确定性校验（无需 GUI）。
// 重点验证不变式： textContent(html) === raw —— 引擎光标/模型同步的根基。
import { renderInline } from '../src/renderer/src/engine/inline'
import { renderBlock } from '../src/renderer/src/engine/block'
import { isValidTable, isSeparatorRow, parseTable, buildTable } from '../src/renderer/src/engine/table'

// 模拟浏览器 textContent：去标签 + 解码实体
function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) pass++
  else {
    fail++
    console.log('  ✗ FAIL:', name)
  }
}

const inlineCases = [
  'plain text',
  'a **bold** b',
  'a *italic* b',
  'x `code` y',
  '~~struck~~',
  '[label](http://example.com)',
  'mix **b** and *i* and `c` and [l](u)',
  'angle < & > chars',
  '**_nested_**',
  'unclosed **bold',
  'a_b_c',
  '中文 **加粗** 测试'
]
for (const raw of inlineCases) {
  check('inline invariant: ' + JSON.stringify(raw), textContent(renderInline(raw)) === raw)
}

const blockCases = [
  '# Heading',
  '## Sub **bold**',
  '> quote text',
  '- item',
  '1. first',
  '1) paren style',
  '- [ ] todo',
  '- [x] done',
  '  - nested item',
  '    - deeper **bold**',
  '  1. nested ol',
  '  - [ ] nested task',
  '\t- tab indented',
  '---',
  '***',
  '___',
  'plain paragraph',
  '',
  '###### h6 with `code`',
  '# 标题 < & >'
]
for (const raw of blockCases) {
  check('block invariant: ' + JSON.stringify(raw), textContent(renderBlock(raw).html) === raw)
}

// 结构正确性抽查
check('bold -> strong', renderInline('**x**').includes('<strong>'))
check('italic -> em', renderInline('*x*').includes('<em>'))
check('code -> code tag', renderInline('`x`').includes('<code>'))
check('strike -> del', renderInline('~~x~~').includes('<del>'))
check('link -> a href', renderInline('[t](u)').includes('<a href="u">'))
check('marker spans present', renderInline('**x**').includes('class="mk"'))
check('h1 type', renderBlock('# x').type === 'h1')
check('h6 type', renderBlock('###### x').type === 'h6')
check('quote type', renderBlock('> x').type === 'quote')
check('ul type', renderBlock('- x').type === 'ul')
check('ol type', renderBlock('1. a').type === 'ol')
check('task type', renderBlock('- [ ] y').type === 'task')
check('task checked flag', renderBlock('- [x] y').checked === true)
check('task unchecked flag', renderBlock('- [ ] y').checked === false)
check('empty -> br', renderBlock('').html === '<br>')
check('not-a-heading (no space)', renderBlock('#notitle').type === 'p')
check('indent level 0', renderBlock('- x').indent === 0)
check('indent level 1', renderBlock('  - x').indent === 1)
check('indent level 2', renderBlock('    - x').indent === 2)
check('tab indent level 1', renderBlock('\t- x').indent === 1)
check('nested ol type', renderBlock('  1. x').type === 'ol')
check('nested task checked', renderBlock('  - [x] y').checked === true)
check('hr dashes', renderBlock('---').type === 'hr')
check('hr stars', renderBlock('***').type === 'hr')
check('hr underscores', renderBlock('___').type === 'hr')
check('hr not 2 dashes', renderBlock('--').type === 'p')
check('valid table', isValidTable('| a | b |\n| --- | --- |\n| 1 | 2 |') === true)
check('table needs separator', isValidTable('| a | b |\n| 1 | 2 |') === false)
check('separator row', isSeparatorRow('| --- | :---: |') === true)
check('not separator row', isSeparatorRow('| a | b |') === false)
check(
  'table parse+build roundtrip',
  isValidTable(buildTable(parseTable('| a | b |\n| --- | :---: |\n| 1 | 2 |'))) === true
)
check('table build keeps align', buildTable(parseTable('| a |\n| :---: |')).includes(':---:'))
// 单元格内含字面竖线：转义后列数不变、内容可还原
const pipeTbl = buildTable({
  headers: ['a | b', 'c'],
  aligns: ['none', 'none'],
  rows: [['1 | 2', '3']]
})
const pipeParsed = parseTable(pipeTbl)
check('cell pipe escaped in source', pipeTbl.includes('a \\| b'))
check('cell pipe keeps col count', pipeParsed.headers.length === 2 && pipeParsed.rows[0].length === 2)
check('cell pipe roundtrips header', pipeParsed.headers[0] === 'a | b')
check('cell pipe roundtrips cell', pipeParsed.rows[0][0] === '1 | 2')
check('cell pipe table still valid', isValidTable(pipeTbl) === true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
