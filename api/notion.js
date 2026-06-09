export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, pageId, action } = req.body;
  if (!token) return res.status(400).json({ error: 'token이 필요해요' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
  };

  // 프로필 조회
  if (action === 'profile') {
    try {
      const r = await fetch('https://api.notion.com/v1/users/me', { headers });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
      const u = await r.json();
      const wr = await fetch('https://api.notion.com/v1/search', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: 1 })
      });
      const ws = await wr.json();
      return res.status(200).json({
        name: u.name || '',
        email: u.person?.email || '',
        avatar: u.avatar_url || '',
        workspace: ws.results?.[0]?.parent?.workspace_id ? '내 워크스페이스' : '내 워크스페이스'
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // 페이지 목록 조회
  if (action === 'list') {
    try {
      const pages = [];
      let cursor = undefined;
      do {
        const body = { filter: { value: 'page', property: 'object' }, page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const res2 = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res2.ok) { const e = await res2.json(); throw new Error(e.message || '목록 조회 실패'); }
        const data = await res2.json();
        for (const p of data.results) {
          const props = p.properties || {};
          const titleProp = Object.values(props).find(v => v.type === 'title');
          const title = titleProp?.title?.map(t => t.plain_text).join('') || p.child_page?.title || '(제목 없음)';
          pages.push({ id: p.id.replace(/-/g, ''), title });
        }
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);
      return res.status(200).json({ pages });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!pageId) return res.status(400).json({ error: 'pageId가 필요해요' });

  // 텍스트 추출 함수 — 볼드 유지 (본문용)
  function extractRichText(richTextArr) {
    if (!richTextArr) return '';
    return richTextArr.map(t => {
      let str = t.plain_text || '';
      if (t.annotations?.bold) str = `**${str}**`;
      return str;
    }).join('');
  }

  // 헤딩 텍스트 추출 — 볼드 무시
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
    if (pageData.child_page?.title) return pageData.child_page.title;
    return '(제목 없음)';
  }

  // 재귀 블록 읽기
  async function fetchBlocks(blockId, depth = 0) {
    if (depth > 8) return '';

    // 모든 블록을 먼저 수집 (페이지네이션 처리)
    const allBlocks = [];
    let cursor = undefined;
    do {
      const url = `https://api.notion.com/v1/blocks/${blockId}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      const data = await response.json();
      allBlocks.push(...data.results.filter(b => b?.type));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // child_database 개수에 따라 렌더 방식 결정
    const dbCount = allBlocks.filter(b => b.type === 'child_database').length;
    const useDbNodes = dbCount >= 2;

    let markdown = '';
    let listCounter = 0;

    for (const block of allBlocks) {
      try {
        const type = block.type;

        if (type === 'heading_1') {
          markdown += '# ' + extractHeadingText(block.heading_1?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'heading_2') {
          markdown += '## ' + extractHeadingText(block.heading_2?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'heading_3') {
          markdown += '### ' + extractHeadingText(block.heading_3?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'heading_4') {
          markdown += '#### ' + extractHeadingText(block.heading_4?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'paragraph') {
          const text = extractRichText(block.paragraph?.rich_text);
          if (text.trim()) markdown += text + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'bulleted_list_item') {
          listCounter = 0;
          markdown += '- ' + extractRichText(block.bulleted_list_item?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'numbered_list_item') {
          listCounter++;
          markdown += `${listCounter}. ` + extractRichText(block.numbered_list_item?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'quote') {
          listCounter = 0;
          markdown += '> ' + extractRichText(block.quote?.rich_text) + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'callout') {
          listCounter = 0;
          const text = extractRichText(block.callout?.rich_text);
          if (text.trim()) markdown += '> ' + text + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
        } else if (type === 'toggle') {
          listCounter = 0;
          const title = extractHeadingText(block.toggle?.rich_text);
          if (title.trim()) markdown += '## ' + title + '\n';
          if (block.has_children) markdown += await fetchBlocks(block.id, depth + 1);
          continue;
        } else if (type === 'child_page') {
          const childTitle = block.child_page?.title || '하위 페이지';
          markdown += `\n## ${childTitle}\n`;
          if (block.has_children) {
            markdown += await fetchBlocks(block.id, depth + 1);
          }
          continue;
        } else if (type === 'child_database') {
          try {
            const dbPages = await fetchDatabaseChildren(block.id);
            const BATCH = 5;

            if (useDbNodes) {
              // DB가 2개 이상: DB 이름을 중간 노드로, 하위 페이지를 그 아래에 배치
              const dbTitle = (block.child_database?.title || 'Database').replace(/\s*\(\d+\)\s*$/, '').trim() || 'Database';
              markdown += `\n# ${dbTitle}\n`;
              for (let i = 0; i < dbPages.length; i += BATCH) {
                const batch = dbPages.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async dbPage => {
                  const pageTitle = extractPageTitle(dbPage);
                  const pageContent = await fetchBlocks(dbPage.id, depth + 2).catch(() => '');
                  // 페이지가 ## 레벨이므로 내부 콘텐츠는 2단계 올림
                  // # → ###, ## → ####, ### → ####, #### → ####
                  const shifted = pageContent
                    .replace(/^(\s*)#### /gm, '$1§4§ ')
                    .replace(/^(\s*)### /gm, '$1§3§ ')
                    .replace(/^(\s*)## /gm, '$1#### ')
                    .replace(/^(\s*)# /gm, '$1### ')
                    .replace(/^(\s*)§3§ /gm, '$1#### ')
                    .replace(/^(\s*)§4§ /gm, '$1#### ');
                  return `\n## ${pageTitle}\n${shifted}`;
                }));
                markdown += results.join('');
              }
            } else {
              // DB가 1개: 현재처럼 하위 페이지를 상위에 직접 연결
              for (let i = 0; i < dbPages.length; i += BATCH) {
                const batch = dbPages.slice(i, i + BATCH);
                const results = await Promise.all(batch.map(async dbPage => {
                  const pageTitle = extractPageTitle(dbPage);
                  const pageContent = await fetchBlocks(dbPage.id, depth + 2).catch(() => '');
                  const shifted = pageContent
                    .replace(/^(\s*)#### /gm, '$1§§§§ ')
                    .replace(/^(\s*)### /gm, '$1#### ')
                    .replace(/^(\s*)## /gm, '$1### ')
                    .replace(/^(\s*)# /gm, '$1## ')
                    .replace(/^(\s*)§§§§ /gm, '$1#### ');
                  return `\n# ${pageTitle}\n${shifted}`;
                }));
                markdown += results.join('');
              }
            }
          } catch (e) { }
          continue;
        }
      } catch (e) {
        // 블록 파싱 실패 시 스킵
      }
    }

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
