export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, pageId } = req.body;
  if (!token || !pageId) return res.status(400).json({ error: 'token과 pageId가 필요해요' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
  };

  // 텍스트 추출 함수 — 볼드 유지 (본문용)
  function extractRichText(richTextArr) {
    if (!richTextArr) return '';
    return richTextArr.map(t => {
      let str = t.plain_text || '';
      if (t.annotations?.bold) str = `**${str}**`;
      return str;
    }).join('');
  }

  // 헤딩 텍스트 추출 — 볼드 무시 (헤딩 자체가 강조이므로)
  function extractHeadingText(richTextArr) {
    if (!richTextArr) return '';
    return richTextArr.map(t => t.plain_text || '').join('');
  }

  // 데이터베이스 하위 페이지 목록 조회
  async function fetchDatabaseChildren(dbId) {
    const pages = [];
    let cursor = undefined;
    do {
      const url = `https://api.notion.com/v1/databases/${dbId}/query`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
      });
      if (!response.ok) break;
      const data = await response.json();
      pages.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
    return pages;
  }

  // 페이지 타이틀 추출
  function extractPageTitle(pageData) {
    const props = pageData.properties || {};
    const titleProp = Object.values(props).find(p => p.type === 'title');
    if (titleProp?.title?.length > 0) {
      return titleProp.title.map(t => t.plain_text).join('');
    }
    // child_page 타입인 경우
    if (pageData.child_page?.title) return pageData.child_page.title;
    return '(제목 없음)';
  }

  // 재귀 블록 읽기 (데이터베이스 하위 페이지 포함)
  async function fetchBlocks(blockId, depth = 0) {
    if (depth > 4) return '';
    let markdown = '';
    let cursor = undefined;
    let listCounter = 0; // 번호 목록 카운터

    do {
      const url = `https://api.notion.com/v1/blocks/${blockId}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      const data = await response.json();

      for (const block of data.results) {
        if (!block?.type) continue;
        try {
          const type = block.type;

          if (type === 'heading_1') {
            markdown += '# ' + extractHeadingText(block.heading_1?.rich_text) + '\n';
          } else if (type === 'heading_2') {
            markdown += '## ' + extractHeadingText(block.heading_2?.rich_text) + '\n';
          } else if (type === 'heading_3') {
            markdown += '### ' + extractHeadingText(block.heading_3?.rich_text) + '\n';
          } else if (type === 'heading_4') {
            markdown += '#### ' + extractHeadingText(block.heading_4?.rich_text) + '\n';
          } else if (type === 'paragraph') {
            const text = extractRichText(block.paragraph?.rich_text);
            if (text.trim()) markdown += text + '\n';
          } else if (type === 'bulleted_list_item') {
            listCounter = 0;
            markdown += '- ' + extractRichText(block.bulleted_list_item?.rich_text) + '\n';
          } else if (type === 'numbered_list_item') {
            listCounter++;
            markdown += `${listCounter}. ` + extractRichText(block.numbered_list_item?.rich_text) + '\n';
          } else if (type === 'quote') {
            listCounter = 0;
            markdown += '> ' + extractRichText(block.quote?.rich_text) + '\n';
          } else if (type === 'callout') {
            listCounter = 0;
            const text = extractRichText(block.callout?.rich_text);
            if (text.trim()) markdown += '> ' + text + '\n';
          } else if (type === 'toggle') {
            listCounter = 0;
            const title = extractHeadingText(block.toggle?.rich_text);
            if (title.trim()) markdown += '#### ' + title + '\n';
          } else if (type === 'child_page') {
            // 하위 페이지 — 재귀적으로 읽기
            const childTitle = block.child_page?.title || '하위 페이지';
            markdown += `\n## ${childTitle}\n`;
            if (block.has_children) {
              markdown += await fetchBlocks(block.id, depth + 1);
            }
            continue;
          } else if (type === 'child_database') {
            const dbTitle = block.child_database?.title || '데이터베이스';
            markdown += `\n# ${dbTitle}\n`;
            try {
              const dbPages = await fetchDatabaseChildren(block.id);
              const BATCH = 5;
              for (let i = 0; i < dbPages.length; i += BATCH) {
                const batch = dbPages.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async dbPage => {
                  const pageTitle = extractPageTitle(dbPage);
                  const pageContent = await fetchBlocks(dbPage.id, depth + 2).catch(() => '');
                  return `\n## ${pageTitle}\n${pageContent}`;
                }));
                markdown += results.join('');
              }
            } catch (e) { }
            continue;
          }
        } catch (e) {
          // 블록 파싱 실패 시 스킵
        }

        // 일반 하위 블록 재귀
        if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
          markdown += await fetchBlocks(block.id, depth + 1);
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return markdown;
  }

  try {
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
    if (!pageRes.ok) {
      const err = await pageRes.json();
      return res.status(pageRes.status).json({ error: err.message || '페이지를 찾을 수 없어요. Integration이 해당 페이지에 연결되어 있는지 확인해주세요.' });
    }

    const pageData = await pageRes.json();
    const pageTitle = extractPageTitle(pageData);
    const markdown = await fetchBlocks(pageId);

    res.status(200).json({ title: pageTitle, markdown });
  } catch (e) {
    res.status(500).json({ error: e.message || '서버 오류가 발생했어요' });
  }
}
