#!/bin/bash
# Same URL on live and staging must give the same status and redirect target.
# Usage: STAGING_AUTH='user:pass' bash check-routes.sh   (the user runs it; the value is theirs)
set -uo pipefail
: "${STAGING_AUTH:?set STAGING_AUTH=user:pass for staging}"
paths=(/ /index.html /about /about.html /contact /demo /careers /careers/ /case-studies /case-studies.html
  /how-it-works /solutions /solutions/x /resources /partners /gate-automation-cost /gate-automation-cost.html
  /dwaar-ai-valet/book-a-demo /dwaar-ai-valet-book-a-demo.html /dwaar-ai-valet/thank-you /dwaar-ai-valet-thank-you.html
  /dwaar-ai-valet/blog /dwaar-ai-valet/blog/ /dwaar-ai-valet-blog.html
  /dwaar-ai-valet/blog/valet-parking-liability-india-hotels /dwaar-ai-valet-blog-valet-parking-liability-india-hotels.html
  /dwaar-ai-valet/blog/images/valet-scratch-hero.jpg /dwaar-ai-valet/blog/images/valet-four-photo-condition-record.png
  /book-a-demo /privacy-policy /no-such-page)
# Staging must demand a password. If it answers anyone, the comparison below is meaningless.
anon=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://staging.dwaarai.com/)
if [ "$anon" != "401" ]; then
  echo "!!! STAGING IS NOT PASSWORD-PROTECTED (unauthenticated request got $anon, expected 401) !!!" >&2
  echo "Restore the Auth* lines in staging's .htaccess (cPanel > Directory Privacy) and run this again." >&2
  exit 2
fi
probe() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 "$@"; }
bad=0
for p in "${paths[@]}"; do
  live=$(probe "https://dwaarai.com$p" | sed 's#https://dwaarai.com##')
  stg=$(probe -u "$STAGING_AUTH" "https://staging.dwaarai.com$p" | sed 's#https://staging.dwaarai.com##')
  if [ "$live" = "$stg" ]; then printf 'same  %-60s %s\n' "$p" "$live"; else printf 'DIFF  %-60s live=[%s] staging=[%s]\n' "$p" "$live" "$stg"; bad=1; fi
done
exit $bad
