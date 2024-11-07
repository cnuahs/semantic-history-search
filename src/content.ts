// send the page info and content to the service worker
import { isProbablyReaderable, Readability } from '@mozilla/readability';

var article = null;
if (isProbablyReaderable(document)) {
    // note: the .parse() method modifies the DOM which would alter the tab content... we avoid
    //       that by passing a clone of the document object to the Readability constructor
    var dom = document.cloneNode(true) as Document;
    article = new Readability(dom).parse();
}

const info = {
    title: document.title,
    href: document.location.href,
    host: document.location.host,
    //
    excerpt: article?.excerpt,
    text: article?.textContent
};

chrome.runtime.sendMessage(info);
