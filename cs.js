//
// Data (r/o):
// - current course version (from URL)
// - current page (from URL)
// - current course info (fetched from network, derived from from URL)
//
// State:
// - popup open? (in DOM)
// - diff section open? (in DOM)
// - selected other course version (in DOM + local storage, per course)
// - scroll position in the list (in DOM)
//

// Utilities

let elemDummyContainer = document.createElement('div');

function elem(html) {
    elemDummyContainer.innerHTML = html;
    return elemDummyContainer.firstChild;
}

//
// Traverse the course info searching for the related section
//

function findOtherSectionID(courseInfo, thisSectionID, otherVersionID) {
    let sectionID = thisSectionID;
    while (sectionID && courseInfo.sections[sectionID].courseVersionID != otherVersionID) {
	sectionID = courseInfo.sections[sectionID].prevVersionID;
    }
    if (sectionID) {
	return sectionID;
    }
    // try in another direction
    sectionID = thisSectionID;
    while (sectionID && courseInfo.sections[sectionID].courseVersionID != otherVersionID) {
	sectionID = courseInfo.sections[sectionID].nextVersionID;
    }
    return sectionID;
}

// Make a combined set of sections of two versions
//
// Returns
// [{
//     thisSectionID: sectionID,
//     otherSectionID: sectionID,
//     // changed: bool, // can be calculated?
// }]
function combinedToc(courseInfo, thisVersion, otherVersion) {
    let tv = courseInfo.versions[thisVersion];
    let ov = courseInfo.versions[otherVersion];

    // find sections matching each other in the versions
    let thisToOther = {}, otherToThis = {};
    for (let thisSectionID of tv.sections) {
	let otherSectionID = findOtherSectionID(courseInfo, thisSectionID, otherVersion);

	thisToOther[thisSectionID] = otherSectionID;
	otherToThis[otherSectionID] = thisSectionID;
    }

    // TODO: match more sections by titles

    // now construct the merged list of sections.
    let thisIdx = 0, otherIdx = 0;
    let merged = [];
    for (; thisIdx < tv.sections.length || otherIdx < ov.sections.length;) {
	if (thisIdx < tv.sections.length && !thisToOther[tv.sections[thisIdx]]) {
	    // section is added
	    merged.push({
		thisSectionID: tv.sections[thisIdx],
	    });
	    thisIdx++;
	} else if (otherIdx < ov.sections.length && !otherToThis[ov.sections[otherIdx]]) {
	    // section is removed
	    merged.push({
		otherSectionID: ov.sections[otherIdx],
	    });
	    otherIdx++;
	} else if (thisIdx < tv.sections.length && otherIdx < ov.sections.length && thisToOther[tv.sections[thisIdx]] == ov.sections[otherIdx]) {
	    // section is changed
	    merged.push({
		thisSectionID: tv.sections[thisIdx],
		otherSectionID: ov.sections[otherIdx],
	    });
	    thisIdx++;
	    otherIdx++;
	} else if (thisIdx < tv.sections.length) {
	    // sections are moved around (should not happen often)
	    merged.push({
		thisSectionID: tv.sections[thisIdx],
		otherSectionID: thisToOther[tv.sections[thisIdx]],
	    })
	    thisIdx++;
	} else {
	    // sections are moved around (should not happen often)
	    merged.push({
		thisSectionID: otherToThis[ov.sections[otherIdx]],
		otherSectionID: ov.sections[otherIdx],
	    })
	    otherIdx++;
	}
    }

    return merged;
}

// Parse course info
//
// Returns
// {
//   versions: {courseVersion: {sections: [sectionID]}},
//   sections: {
//     sectionID: {
//       title: title,
//       prevVersionID: sectionID,
//       nextVersionID: sectionID,
//       courseVersionID: courseVersion,
//   },
//   activeVersion: courseVersion,
// }
//
function parseCourseInfo(rawInfo) {
    let versions = {}, sections = {};
    let activeVersion;

    // Courses in rawInfo are sorted oldest to newest
    for (let i = rawInfo.length-1; i >= 0; i--) {
	let rawCourseVersion = rawInfo[i];
	activeVersion = rawCourseVersion.course.activeVersion;

	let courseSections = [];
	for (let rawSection of rawCourseVersion.sections) {
	    sections[rawSection.id] = {
		title: rawSection.title,
		prevVersionID: rawSection.prevVersionSectionId,
		courseVersionID: rawCourseVersion.version,
	    };
	    courseSections.push(rawSection.id);
	}
	versions[rawCourseVersion.version] = {sections: courseSections};
    }
    for (let sectionID in sections) {
	if (sections[sectionID].prevVersionID) {
	    sections[sections[sectionID].prevVersionID].nextVersionID = sectionID;
	}
    }

    return {versions, sections, activeVersion};
}

async function rawCourseVersions(courseName) {
    // TODO: retry on error
    let resp = await fetch('https://aisystant.system-school.ru/api/courses/course-versions?course-path='+courseName);
    if (!resp.ok) {
	throw new Error("HTTP error "+resp.status);
    }
    return await resp.json();
}

function parseCoursePageURL() {
    let url = new URL(window.location.href);
    let match = url.hash.match(/^#\/course\/([^\/]+)\/([^\/]+)\/(\d+)/);
    if (match) {
	return {name: match[1], version: match[2], pageID: match[3]};
    }
}

let cachedCourses = {};

async function getCourseInfo(thisPageCourseMeta) {
    if (!thisPageCourseMeta) { // not on a course page
	return;
    }
    let thisCourseName = thisPageCourseMeta.name
    if (!cachedCourses[thisCourseName]) {
	let rawInfo = await rawCourseVersions(thisCourseName);
	cachedCourses[thisCourseName] = await parseCourseInfo(rawInfo);
    }
    return cachedCourses[thisCourseName];
}

//
// Construct UI
//

let uiTocOpen;  // #toc-open - a button to open the popup
let uiToc;      // #toc - a view for merged ToC
let uiTocTable; // #toc-table - a table for merged ToC
let uiCurrentVersion;
let uiSelectOtherVersion;
let uiDiff;     // #diff - a view for text diff
let uiDiffContent;

function constructUI() {
    /* Heroicons, MIT https://heroicons.com/ */
    uiTocOpen = elem(`<div id="toc-open" class="open">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6">
    <path fill-rule="evenodd" d="M10.72 11.47a.75.75 0 0 0 0 1.06l7.5 7.5a.75.75 0 1 0 1.06-1.06L12.31 12l6.97-6.97a.75.75 0 0 0-1.06-1.06l-7.5 7.5Z" clip-rule="evenodd" />
    <path fill-rule="evenodd" d="M4.72 11.47a.75.75 0 0 0 0 1.06l7.5 7.5a.75.75 0 1 0 1.06-1.06L6.31 12l6.97-6.97a.75.75 0 0 0-1.06-1.06l-7.5 7.5Z" clip-rule="evenodd" />
  </svg>
</div>`);
    document.body.appendChild(uiTocOpen);
    uiTocOpen.addEventListener('click', openToc);

    uiToc = elem(`<div id="toc">
<div style="padding: 1em; background: white">
  <div style="display:flex; justify-content: space-between">
    <div>Current version: <span id="current-version"></span></div>
    <div>
      Compared with version:
      <select style="appearance: auto" id="select-other-version">
      </select>
    </div>
  </div>
  <div style="height:80vh; overflow-y:scroll; scrollbar-width: 0.1em">
    <div id="toc-table">
    </div>
  </div>
  <div id="toc-close" style="background:white">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red" class="w-6 h-6">
      <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clip-rule="evenodd" />
    </svg>
  </div>
</div>
</div>`);
    document.body.appendChild(uiToc);
    let uiTocClose = document.getElementById('toc-close');
    uiTocClose.addEventListener('click', closeToc);

    uiCurrentVersion = document.getElementById('current-version');

    uiSelectOtherVersion = document.getElementById('select-other-version');
    uiSelectOtherVersion.addEventListener('change', selectOtherVersion);

    uiTocTable = document.getElementById('toc-table');
    uiTocTable.addEventListener('click', onTocTableClick);

    uiDiff = elem(`<div id="diff">
  <div id="diff-content">
  </div>
  <div id="diff-close" style="background:white">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red" class="w-6 h-6">
      <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clip-rule="evenodd" />
    </svg>
  </div>
</div>`);
    document.body.appendChild(uiDiff);
    let uiDiffClose = document.getElementById('diff-close');
    uiDiffClose.addEventListener('click', closeDiff);
    uiDiffContent = document.getElementById('diff-content');
}

function closeToc() {
    uiTocOpen.classList.add('open')
    uiToc.classList.remove('open');
}

function closeDiff() {
    uiDiff.classList.remove('open');
}

async function openToc() {
    let pu = parseCoursePageURL();

    if (!pu) {
	text = "Not a course page: navigate to course page and open again.";
    } else {
	text = "Loading...";
    }
    uiTocTable.innerHTML = `<div style="display: flex; justify-content: center; align-items: center; height: 10em">`+text+`</div>`;
    uiTocOpen.classList.remove('open');
    uiToc.classList.add('open');

    if (pu) {
	let ci = await getCourseInfo(pu);
	let v = await getOtherVersion(ci, pu);
	populateTocUI(ci, pu, v);
	populateVersionsUI(ci, pu.version, v);
    }
}

async function selectOtherVersion(e) {
    let pu = parseCoursePageURL();
    let ci = await getCourseInfo(pu);

    let v = uiSelectOtherVersion.value;
    let k = "selected-version-for/"+pu.name+'/'+pu.version;
    await chrome.storage.local.set({[k]: v});

    populateTocUI(ci, pu, v);
}

let otherPageDivRx = /^other-page-(\d+)/;

function onTocTableClick(e) {
    let m = e.target.id.match(otherPageDivRx);
    if (m) {
	let otherPageID = m[1];
	let pageInfo = parseCoursePageURL();
	showDiff(pageInfo.pageID, otherPageID);
    }
}

async function showDiff(thisPageID, otherPageID) {
    let thisPage = fetch("https://aisystant.system-school.ru/api/courses/text/"+thisPageID);
    let otherPage = fetch("https://aisystant.system-school.ru/api/courses/text/"+otherPageID);

    let thisResp = await thisPage;
    // TODO: retry
    if (!thisResp.ok) {
	throw new Error("HTTP error "+thisResp.status);
    }
    let otherResp = await otherPage;
    if (!otherResp.ok) {
	throw new Error("HTTP error "+otherResp.status);
    }

    let thisText = await thisResp.text();
    let otherText = await otherResp.text();

    let diff = HtmlDiff.execute(otherText, thisText);
    uiDiffContent.innerHTML = diff;
    uiDiff.classList.add('open');
    queueMicrotask(()=>{
	uiDiff.scrollTo(0, 0);
    });
}

function populateVersionsUI(courseInfo, thisVersion, otherVersion) {
    let t = '';

    let versions = Object.keys(courseInfo.versions);
    versions.sort();
    versions.reverse();

    for (let version of versions) {
	t += '<option value="'+version+'"';
	if (version == thisVersion) {
	    t += ' disabled';
	}
	if (version == otherVersion) {
	    t += ' selected';
	}
	t += '>'+version+'</option>';
    }
    uiSelectOtherVersion.innerHTML = t;
    uiCurrentVersion.innerHTML = thisVersion;
}

function populateTocUI(courseInfo, thisPageCourseMeta, otherVersion) {
    let comToc = combinedToc(courseInfo, thisPageCourseMeta.version, otherVersion);

    let t = '<table>'
    for (let section of comToc) {
	let thisSectionTitle = (courseInfo.sections[section.thisSectionID]||{}).title||'';
	let otherSectionTitle = (courseInfo.sections[section.otherSectionID]||{}).title||'';
	t += '<tr>';
	t += '<td';
	if (section.thisSectionID) {
	    t += ' id="this-page-'+section.thisSectionID+'"';
	}
	t += ' class="toc-this-page ';
	if (thisPageCourseMeta.pageID == section.thisSectionID) {
	    t += 'toc-current-page"';
	}
	t +='">'+thisSectionTitle+'</td>';
	t += '<td></td>';
	t += '<td class="toc-other-page"';
	if (section.otherSectionID) {
	    t += ' id="other-page-'+section.otherSectionID+'"';
	}
	t += '>'+otherSectionTitle+'</td>';
	t += '</tr>';
    }
    t += '</table>'
    uiTocTable.innerHTML = t;

    queueMicrotask(()=>{
	let el = document.getElementById('this-page-'+thisPageCourseMeta.pageID);
	el.scrollIntoView({block: 'center', inline: 'nearest'});
    });
}

function chooseOtherVersion(courseInfo, thisPageCourseMeta) {
    // If we're looking at non-active version, then compare it with the active one
    if (thisPageCourseMeta.version != courseInfo.activeVersion) {
	return courseInfo.activeVersion;
    }

    // We're looking at active version, select the one before active.
    let maxBelowActive = '0000-00-00';
    for (let ver in courseInfo.versions) {
	if (ver < courseInfo.activeVersion && ver > maxBelowActive) {
	    maxBelowActive = ver;
	}
    }

    if (maxBelowActive) { // found some
	return maxBelowActive;
    }

    // Fallback. Any will do.
    return courseInfo.activeVersion;
}

async function getOtherVersion(courseInfo, thisPageCourseMeta) {
    // If we have a stored value for this course+version, use it
    let k = 'selected-version-for/'+thisPageCourseMeta.name+'/'+thisPageCourseMeta.version;
    let selVer = (await chrome.storage.local.get(k))[k];
    if (selVer) {
        // Check that this version is still available
        if (courseInfo.versions[selVer]) {
            return selVer;
        }
    }
    selVer = chooseOtherVersion(courseInfo, thisPageCourseMeta);
    let data = {[k]: selVer};
    await chrome.storage.local.set(data);
    return selVer;
}

(async function() {
    constructUI();
    let pu = parseCoursePageURL();
    let ci = await getCourseInfo(pu); // prefetch current page's course info
})();


//
// Clean up whenever extension is reloaded (mostly for developent)
//

function tearDown() {
    for (id of ["toc-open","toc", "diff"]) {
	let el = document.getElementById(id);
	if (el) el.remove();
    }
    browser.runtime.onMessage.removeListener(onMessage);
}
function onMessage(msg, sender) {
    if (sender.id === browser.runtime.id && msg === "restart") {
	tearDown();
    }
}
browser.runtime.onMessage.addListener(onMessage);
