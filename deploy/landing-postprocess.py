#!/usr/bin/env python3
"""
Reapply the live-site customizations that every design-tool export drops.
Run against the staged export before deploying to /opt/communitygate/landing.

Steps, all idempotent:
  1. every Google Fonts CDN <link> -> one self-hosted /fonts.css
  2. dead <a href="#">Login / Sign Up</a> -> /admin
  3. fake onsubmit handlers -> data-subject attributes read by forms.js
  4. <script src="forms.js" defer> on pages that have a form
  5. Organization/WebSite JSON-LD on the homepage
"""
import io
import os
import re
import sys
import glob

STAGE = sys.argv[1]

GFONT_LINK = re.compile(
    r'[ \t]*<link[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\n?')
FONTS_CSS = '<link rel="stylesheet" href="/fonts.css">\n'

JSONLD = (
    '  <script type="application/ld+json">{"@context":"https://schema.org","@graph":'
    '[{"@type":"Organization","@id":"https://dwaarai.com/#org","name":"Dwaar AI",'
    '"legalName":"Entriva Technologies Pvt. Ltd.","url":"https://dwaarai.com/",'
    '"logo":"https://dwaarai.com/android-chrome-512x512.png","email":"hello@dwaarai.com",'
    '"description":"AI-powered gate management and community intelligence platform for '
    'residential communities in India.","areaServed":"IN","contactPoint":{"@type":"ContactPoint",'
    '"email":"hello@dwaarai.com","contactType":"sales"}},{"@type":"WebSite",'
    '"@id":"https://dwaarai.com/#website","url":"https://dwaarai.com/","name":"Dwaar AI",'
    '"publisher":{"@id":"https://dwaarai.com/#org"}}]}</script>\n')

DASH = u'—'

# The three fake-handler shapes the exporter emits.
EARLY = ('<form class="early-access-card" onsubmit="event.preventDefault(); '
         "var b=this.querySelector('.btn-primary'); b.textContent='Request received'; "
         "b.style.background='var(--color-brand-teal)';\">")
CONTACT = ('<form class="contact-form" onsubmit="event.preventDefault(); '
           "var b=this.querySelector('.btn-primary'); b.textContent='Request received'; "
           "b.style.background='var(--color-brand-teal)';\">")
SUBMITBTN = ('<form onsubmit="event.preventDefault(); '
             "this.querySelector('.submit-btn').textContent='Request received'; "
             "this.querySelector('.submit-btn').style.background='var(--teal)';\">")

# page -> ordered list of (export form tag, live form tag)
FORMS = {
    'index.html': [
        ('<form class="contact-form" onsubmit="return false;">',
         '<form class="contact-form" data-subject="New website enquiry %s dwaarai.com">' % DASH)],
    'basera-resident-app.html': [
        (EARLY,
         '<form class="early-access-card" data-subject="New early-access signup '
         '(Basera Resident App) %s dwaarai.com">' % DASH)],
    'nazar-guard-app.html': [
        (EARLY,
         '<form class="early-access-card" data-subject="New early-access signup '
         '(Nazar Guard App) %s dwaarai.com">' % DASH)],
    'rwa-admin-portal.html': [
        (EARLY,
         '<form class="early-access-card" data-subject="New early-access signup '
         '(RWA Admin Portal) %s dwaarai.com">' % DASH)],
    'blog.html': [
        ('<form class="newsletter-form" onsubmit="event.preventDefault();">',
         '<form class="newsletter-form" data-subject="New newsletter signup %s dwaarai.com" '
         'data-success="Subscribed">' % DASH)],
    'book-a-demo.html': [
        (SUBMITBTN, '<form data-subject="New Demo booking %s dwaarai.com">' % DASH)],
    'request-a-site-survey.html': [
        (SUBMITBTN, '<form data-subject="New Site survey request %s dwaarai.com">' % DASH)],
    'contact-us.html': [
        (CONTACT, '<form class="contact-form" data-subject="New Sales enquiry %s dwaarai.com">' % DASH),
        (CONTACT, '<form class="contact-form" data-subject="New Support request %s dwaarai.com">' % DASH)],
}

# The exporter strips name= off some form fields. FormData() only serialises
# named fields, so an unnamed field is silently dropped and the lead arrives
# blank. Field names in document order, matching the live site.
FIELD_NAMES = {
    'blog.html': ['email'],
    'book-a-demo.html': ['name', 'mobile', 'society', 'city',
                         'units', 'role', 'interest', 'demo_type'],
    'request-a-site-survey.html': ['name', 'mobile', 'email', 'society', 'address',
                                   'units', 'gates', 'current_setup',
                                   'preferred_date', 'role', 'notes'],
}
FIELD_TAG = re.compile(r'<(input|select|textarea)\b[^>]*>')
SKIP_TYPE = re.compile(r'type="(?:submit|button|hidden)"')


def name_fields(src, names, rel):
    """Inject name="..." onto the form's unnamed fields, in document order."""
    form = re.search(r'<form\b.*?</form>', src, re.S)
    if not form:
        sys.exit('FAIL %s: no <form> found' % rel)
    blk = form.group(0)
    idx = [0]

    def repl(m):
        tag = m.group(0)
        if SKIP_TYPE.search(tag):
            return tag
        i = idx[0]
        idx[0] += 1
        if 'name="' in tag:
            return tag
        if i >= len(names):
            sys.exit('FAIL %s: more fields than known names' % rel)
        return '<' + m.group(1) + ' name="%s"' % names[i] + tag[len(m.group(1)) + 1:]

    new_blk = FIELD_TAG.sub(repl, blk)
    if idx[0] != len(names):
        sys.exit('FAIL %s: expected %d fields, found %d' % (rel, len(names), idx[0]))
    return src[:form.start()] + new_blk + src[form.end():]


pages = sorted(glob.glob(os.path.join(STAGE, '*.html')) +
               glob.glob(os.path.join(STAGE, '*', '*.html')) +
               glob.glob(os.path.join(STAGE, '*', '*', '*.html')))

report = []
for path in pages:
    rel = os.path.relpath(path, STAGE).replace(chr(92), '/')
    src = io.open(path, encoding='utf-8').read()
    orig = src
    acts = []

    # 1. self-hosted fonts instead of the Google Fonts CDN
    hits = list(GFONT_LINK.finditer(src))
    if hits:
        at = hits[0].start()
        src = GFONT_LINK.sub('', src)
        src = src[:at] + FONTS_CSS + src[at:]
        acts.append('fonts.css (-%d cdn)' % len(hits))

    # 2. re-wire the dead Login / Sign Up placeholders
    n = (src.count('<a href="#" class="btn btn-ghost">Login / Sign Up</a>') +
         src.count('<a href="#">Login / Sign Up</a>'))
    if n:
        src = src.replace('<a href="#" class="btn btn-ghost">Login / Sign Up</a>',
                          '<a href="/admin" class="btn btn-ghost">Login / Sign Up</a>')
        src = src.replace('<a href="#">Login / Sign Up</a>',
                          '<a href="/admin">Login / Sign Up</a>')
        acts.append('login x%d' % n)

    # 3. real form wiring: fake onsubmit -> data-subject consumed by forms.js
    if rel in FORMS:
        for old, new in FORMS[rel]:
            if old not in src:
                sys.exit('FAIL %s: expected form tag not found:\n  %s' % (rel, old[:100]))
            src = src.replace(old, new, 1)
        acts.append('forms x%d' % len(FORMS[rel]))

        # 3b. restore stripped field names, else the lead posts blank
        if rel in FIELD_NAMES:
            before = len(re.findall(r'\bname="', src))
            src = name_fields(src, FIELD_NAMES[rel], rel)
            added = len(re.findall(r'\bname="', src)) - before
            if added:
                acts.append('field-names +%d' % added)

        # 4. load the form handler
        if 'forms.js' not in src:
            src = src.replace('</body>', '  <script src="forms.js" defer></script>\n</body>', 1)
            acts.append('forms.js')

    # 5. point internal links at the canonical "/" rather than /index.html,
    #    which nginx 301s away (costs a redirect hop on every nav click).
    n = len(re.findall(r'href="/?index\.html', src))
    if n:
        src = re.sub(r'href="/?index\.html"', 'href="/"', src)
        src = re.sub(r'href="/?index\.html#', 'href="/#', src)
        acts.append('canonical-home x%d' % n)

    # 6. Organization / WebSite JSON-LD on the homepage
    if rel == 'index.html' and '"@id":"https://dwaarai.com/#org"' not in src:
        src = src.replace('</head>', JSONLD + '</head>', 1)
        acts.append('json-ld')

    if src != orig:
        io.open(path, 'w', encoding='utf-8', newline='').write(src)
    report.append('%-44s %s' % (rel, ', '.join(acts) if acts else '-'))

print('\n'.join(report))
