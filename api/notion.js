export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, pageId } = req.body;
  if (!token || !pageId) return res.status(400).json({ error: 'token과 pageId가 필요해요' });

  // 재귀적으로 블록 가져오기
  async function fetchBlocks(blockId) {
    let markdown = '';
    let cursor = undefined;

    do {
      const url = `https://api.notion.com/v1/blocks/${blockId}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        }
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Notion API 오류');
      }

      const data = await response.json();

      for (const block of data.results) {
        if (!block || !block.type) continue;

        try {
          const type = block.type;

          // 텍스트 추출 함수 (볼드 유지)
          function extractRichText(richTextArr) {
            if (!richTextArr) return '';
            return richTextArr.map(t => {
              let str = t.plain_text || '';
              if (t.annotations?.bold) str = `**${str}**`;
              return str;
            }).join('');
          }

          if (type === 'heading_1') {
            markdown += '# ' + extractRichText(block.heading_1?.rich_text) + '\n';
          } else if (type === 'heading_2') {
            markdown += '## ' + extractRichText(block.heading_2?.rich_text) + '\n';
          } else if (type === 'heading_3') {
            markdown += '### ' + extractRichText(block.heading_3?.rich_text) + '\n';
          } else if (type === 'heading_4') {
            markdown += '#### ' + extractRichText(block.heading_4?.rich_text) + '\n';
          } else if (type === 'paragraph') {
            const text = extractRichText(block.paragraph?.rich_text);
            if (text.trim()) markdown += text + '\n';
          } else if (type === 'bulleted_list_item') {
            markdown += '- ' + extractRichText(block.bulleted_list_item?.rich_text) + '\n';
          } else if (type === 'numbered_list_item') {
            markdown += '1. ' + extractRichText(block.numbered_list_item?.rich_text) + '\n';
          } else if (type === 'quote') {
            markdown += '> ' + extractRichText(block.quote?.rich_text) + '\n';
          } else if (type === 'callout') {
            const text = extractRichText(block.callout?.rich_text);
            if (text.trim()) markdown += '> ' + text + '\n';
          } else if (type === 'toggle') {
            markdown += '#### ' + extractRichText(block.toggle?.rich_text) + '\n';
          }
        } catch (e) {
          // 블록 파싱 실패 시 스킵
        }

        // 하위 블록 재귀 탐색
        if (block.has_children) {
          markdown += await fetchBlocks(block.id);
        }
      }

      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return markdown;
  }

  try {
    // 페이지 타이틀 가져오기
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      }
    });

    if (!pageRes.ok) {
      const err = await pageRes.json();
      return res.status(pageRes.status).json({ error: err.message || '페이지를 찾을 수 없어요' });
    }

    const pageData = await pageRes.json();
    const titleProp = Object.values(pageData.properties || {}).find(p => p.type === 'title');
    const pageTitle = titleProp?.title?.map(t => t.plain_text).join('') || '노션 페이지';

    const markdown = await fetchBlocks(pageId);

    res.status(200).json({ title: pageTitle, markdown });
  } catch (e) {
    res.status(500).json({ error: e.message || '서버 오류가 발생했어요' });
  }
}
