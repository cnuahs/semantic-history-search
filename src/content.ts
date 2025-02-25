// content script to send page info and content to the service worker

// 2024-11-07 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { isProbablyReaderable, Readability } from "@mozilla/readability";

var article = null;
if (isProbablyReaderable(document)) {
  // note: the .parse() method modifies the DOM which would alter the tab content... we avoid
  //       that by passing a clone of the document object to the Readability constructor
  var dom = document.cloneNode(true) as Document;
  article = new Readability(dom).parse();
}

// FIXME: do we want to discard the markup? Couldn't we use that for splitting the text?
// FIXME: how do we handle PDFs?

const msg = {
  type: "add-bookmark",
  payload: {
    title: document.title,
    href: document.location.href,
    host: document.location.host,
    //
    excerpt: article?.excerpt,
    text: article?.textContent,
  },
};

chrome.runtime.sendMessage(msg);
