"""离线校验公开期次 JSON，并演示网页/飞书共用同一份数据。
只用标准库；不联网、不调用 AI、不发送任何消息。
用法：python3 -I validate_issue.py ../data/issues/2026-10-20.json [--feishu]
"""
import json, re, sys
from urllib.parse import urlsplit

SCHEMA = 'ui-brief-v2-proposal'
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ID = re.compile(r'^[a-z0-9][a-z0-9-]*$')
EMPTY_PHRASES = ('提高效率', '关注趋势', '持续学习', '保持关注')


def text(v):
    return isinstance(v, str) and v.strip()


def strs(v):
    return isinstance(v, list) and all(text(x) for x in v)


def safe_url(v):
    try:
        p = urlsplit(v)
        return p.scheme in ('http', 'https') and bool(p.hostname) and not p.username and not p.password
    except (ValueError, TypeError, AttributeError):
        return False


def check_article(a, i):
    errs = []
    e = lambda m: errs.append(f'articles[{i}] {m}')
    if not isinstance(a, dict):
        return [f'articles[{i}] 不是对象']
    if not ID.match(a.get('id', '')):
        e('id 不合法')
    for k in ('title', 'takeaway', 'summary'):
        if not text(a.get(k)):
            e(f'{k} 缺失或为空')
    for k in ('key_points', 'constraints'):
        if not strs(a.get(k, [])):
            e(f'{k} 必须是非空字符串列表（可为空列表）')
    for k in ('impact', 'advice'):
        v = a.get(k)
        if not (v is None or text(v)):
            e(f'{k} 必须是文本或 null')
        if text(v) and any(p in v for p in EMPTY_PHRASES):
            e(f'{k} 含空话（{[p for p in EMPTY_PHRASES if p in v]}），需改写')
    tags = a.get('tags')
    if not strs(tags) or not 1 <= len(tags) <= 5 or len(set(t.strip() for t in tags)) != len(tags):
        e('tags 需 1～5 个且不重复')
    s = a.get('source') or {}
    if not text(s.get('name')) or not safe_url(s.get('url')) or not text(s.get('original_title')):
        e('source.name/url/original_title 不合法')
    kind = s.get('date_kind')
    if kind not in ('published', 'updated', 'unknown'):
        e('source.date_kind 不合法')
    elif kind == 'unknown' and s.get('date') is not None:
        e('date_kind=unknown 时 date 必须为 null（不补造日期）')
    elif kind != 'unknown' and not (isinstance(s.get('date'), str) and DATE.match(s['date'])):
        e('date 必须是 YYYY-MM-DD')
    st = a.get('analysis_status')
    if st not in ('ready', 'needs_review', 'insufficient_source'):
        e('analysis_status 不合法')
    if st == 'ready':
        if not (text(a.get('impact')) and text(a.get('advice')) and len(a.get('key_points', [])) >= 1):
            e('analysis_status=ready 要求 impact、advice 非空且至少 1 条 key_point；否则应为 needs_review')
        if a.get('review_status') != 'reviewed':
            e('ready 文章必须 review_status=reviewed')
    if a.get('review_status') not in ('not_reviewed', 'reviewed'):
        e('review_status 不合法')
    if text(a.get('takeaway')) and text(a.get('title')) and a['takeaway'].strip() == a['title'].strip():
        e('takeaway 不能只是标题换句话')
    return errs


def validate(issue):
    errs = []
    if not isinstance(issue, dict):
        return ['根对象不是 JSON object']
    if issue.get('schema_version') != SCHEMA:
        errs.append('schema_version 不符')
    if not ID.match(issue.get('issue_id', '')):
        errs.append('issue_id 不合法')
    if not (isinstance(issue.get('issue_date'), str) and DATE.match(issue['issue_date'])):
        errs.append('issue_date 不合法')
    if issue.get('status') not in ('demo', 'published'):
        errs.append('status 只能是 demo/published；draft 不进公开目录')
    for k in ('title', 'intro'):
        if not text(issue.get(k)):
            errs.append(f'{k} 缺失')
    arts = issue.get('articles')
    if not isinstance(arts, list):
        return errs + ['articles 必须是列表（可为空）']
    ids = set()
    for i, a in enumerate(arts):
        errs += check_article(a, i)
        if isinstance(a, dict):
            if a.get('id') in ids:
                errs.append(f'articles[{i}] id 重复')
            ids.add(a.get('id'))
    if issue.get('status') == 'published' and any(a.get('review_status') != 'reviewed' for a in arts if isinstance(a, dict)):
        errs.append('published 期次不能含未审核文章')
    for k in ('content', 'scores', 'reason', 'evidence_notes', 'excluded', 'source_selection', 'provenance'):
        if any(k in a for a in arts if isinstance(a, dict)) or k in issue:
            errs.append(f'公开文件不应包含内部字段 {k}')
    return errs


def render_feishu_text(issue, site_base='https://example.invalid/brief/'):
    """飞书文本由同一份期次数据渲染：只压缩密度，不另造内容。平台长度限制实现前需核实。"""
    d = issue['issue_date'].replace('-', '.')
    lines = [f"UI 设计简报 {d}（{len(issue['articles'])} 条）", '']
    if not issue['articles']:
        lines.append(issue.get('note') or '本期没有合适的内容。')
    for n, a in enumerate(issue['articles'], 1):
        lines.append(f"{n}. {a['title']}")
        lines.append(a['takeaway'])
        if a.get('impact'):
            lines.append('影响：' + a['impact'])
        lines.append('主题：' + ' / '.join(a['tags']))
        lines.append(f"原文：{a['source']['url']}")
        lines.append(f"要点与建议：{site_base}?date={issue['issue_date']}#a-{a['id']}")
        lines.append('')
    lines.append('影响与建议为 AI 推论，请结合项目判断。')
    return '\n'.join(lines)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    issue = json.load(open(argv[1], encoding='utf-8-sig'))
    errs = validate(issue)
    print(f"{argv[1]}: {'通过' if not errs else '未通过'}；{len(issue.get('articles', []))} 条")
    for m in errs:
        print(' -', m)
    if '--feishu' in argv:
        print('\n--- 飞书文本（由同一份数据渲染）---\n' + render_feishu_text(issue))
    return 1 if errs else 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
