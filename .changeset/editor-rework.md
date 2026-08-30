---
'@pylinka/site': patch
---

The editor is rebuilt around the two things the work actually is: a graph, and the thing it produces.

Monochrome shell with family hues at low chroma on the nodes; an even split between graph and preview; the node palette replaced by a right-click menu on the canvas; one settings surface behind Project → Settings; knobs are interactive nodes rather than a side tab; emitters are real tabs that open into the canvas, reorderable because that order is the draw order.

Graph problems now appear on the node they belong to, and a wire whose ends disagree on a type will not land. Selections and whole emitters copy to the system clipboard as JSON — pasteable into another project, another window, or a message — and a new emitter can start from one of eleven templates.
