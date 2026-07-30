FROM nginx:1.27-alpine

COPY deploy/production/nginx.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html
COPY index.html admin.html api-docs.html delete-account.html privacy.html terms.html ./
COPY google2af40cd8294faa15.html 1badcdd4-dd4e-4de5-84bc-2f82feef1dd9.txt robots.txt sitemap.xml ./
COPY assets ./assets
COPY blog ./blog
COPY css ./css
COPY i18n ./i18n
COPY js ./js

