/*  
    crawler.js - sobnik.chrome module

    Copyright (c) 2014 Artur Brugeman <brugeman.artur@gmail.com>
    Copyright other contributors as noted in the AUTHORS file.

    This file is part of sobnik.chrome, Sobnik plugin for Chrome:
    http://sobnik.com.

    This is free software; you can redistribute it and/or modify it under
    the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation; either version 3 of the License, or (at
    your option) any later version.

    This software is distributed in the hope that it will be useful, but
    WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
    Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public
    License along with this program. If not, see
    <http://www.gnu.org/licenses/>.
*/

;(function () {

    console.log ("Loading crawler");

    var sobnik = window.sobnik;
    console.assert (sobnik, "Sobnik required");

    var cmn = sobnik.require ("cmn");

    var crawlerTabSignal = "sobnik-chrome-crawler-tab-signal";

    function bgStart ()
    {
	console.log ("Loading crawler.bg");

	var server = sobnik.require ("server.bg");

	var self = {
	    ad: {},
	    tab: null,
	    to: null,
	    cb: null,
	    failures: 0,
	    is_ready: false,
	}

	function callback ()
	{
	    if (self.cb)
		self.cb ();
	    self.cb = null;
	}
	
	function clearTTL ()
	{
	    if (self.to != null)
		clearTimeout (self.to);
	    self.to = null;
	    self.failures = 0;
	}

	function checkTab (t, callback)
	{
	    chrome.tabs.executeScript (t, {
		code: "document.getElementById ('"
		    +crawlerTabSignal+"') != null",
	    }, function (result) {
		var found = false;
		var error = chrome.runtime.lastError;
//		console.log ("Tab", t, error, result);
		if (!error && result)
		{
		    result.forEach (function (f) {
			if (f)
			    found = true;
		    });
		}

		callback (found, error);
	    })
	}

	function close () 
	{
	    clearTTL ();
	    if (!self.tab)
	    {
		callback ();
		return;
	    }

	    // check if tab is still ours
	    var t = self.tab;
	    self.tab = null;
	    checkTab (t, function (found) {
		if (found) 
		{
		    console.log ("Tab is still ours");
		    // remove
		    chrome.tabs.remove (Number(t), function () {
			if (chrome.runtime.lastError)
			    console.log (chrome.runtime.lastError);
			callback ();
		    });
		}
		else
		{
		    console.log ("Tab is not ours");
		    callback ();
		}
	    });
	}

	function startTab (t) 
	{
	    var ttl = 300000; // ms, 300 sec
	    self.tab = t.id;

	    // start killer
	    self.to = cmn.later (ttl, function () {
		if (self.tab != null)
		    self.failures++;
		console.log ("TTL expired", self.failures);
		if (self.failures > 2)
		    close ();
		else
		    callback ();
	    });

	    if (chrome.runtime.lastError)
		console.log (chrome.runtime.lastError);

	    // maybe user closed it immediately after we requested the update
	    if (!self.tab)
		return;

	    // notice if tab gets closed
	    chrome.tabs.onRemoved.addListener(function (id) {
		if (id == self.tab)
		{
		    self.tab = null;
		    clearTTL ();
		    callback ();
		}
	    })
	}

	function searchCrawlerTab (incognito, callback)
	{
	    // reset
	    self.tab = null;

	    // search crawler tab
	    chrome.windows.getAll ({populate: true}, function (ws) {

		// no windows?
		if (ws.length == 0)
		{
		    callback ();
		    return;
		}

		// for each window
		var tabsCount = 0;
		ws.forEach (function (w) {

		    // for each tab
		    w.tabs.forEach (function (t) {

			// count this tab
			tabsCount++;
			checkTab (t.id, function (found) {

			    // count back this tab
			    tabsCount--;

			    // found?
			    if (found && self.tab == null)
			    {
				if (!t.incognito && incognito)
				{
				    // close our tab as we've obviously 
				    // switched to incognito crawling
				    chrome.tabs.remove (Number(t.id));
				}
				else
				{
				    // yes!
				    self.tab = t.id;
				    callback ();
				}
			    }

			    // was it the last tab and we found nothing?
			    if (tabsCount == 0 && self.tab == null)
				callback ();
			})
		    })
		})

		if (tabsCount == 0 && self.tab == null)
		    callback ();
	    })
	}

	function open (ad, cback)
	{
	    console.log (ad);
	    self.ad = ad;
	    self.cb = cback;
	    self.is_ready = false;

	    clearTTL ();

	    var incognito = false;

	    function doOpen ()
	    {
		// now, if no crawler tab found - go create one
		if (self.tab == null)
		{
		    var wid = null;
		    function start ()
		    {
			chrome.tabs.create ({
			    windowId: wid,
			    url: ad.Url,
			    active: false,
			    selected: false,
			}, startTab);
		    }

		    // search incognito window - use it by default
		    chrome.windows.getAll (function (windows) {
			if (chrome.runtime.lastError)
			    console.log (chrome.runtime.lastError);

			windows.forEach (function (w) {
			    if (w.incognito && w.id)
				wid = w.id;
			});

			// no incognito window found, but user
			// requested incognito mode - open new window
			if (incognito && wid == null)
			    chrome.windows.create ({incognito: true}, function (w) {
				console.log (w);
				if (chrome.runtime.lastError)
				    console.log (chrome.runtime.lastError);

				// w == null if user disallowed
				// incognito access while opening
				if (w)
				    wid = w.id;
				start ();
			    })
			else
			    start ();
		    })
		}
		else
		{
		    console.log ("reusing", self.tab);
		    chrome.tabs.update (self.tab, {
			url: ad.Url
		    }, startTab);
		}
	    }


	    // get settings and start
	    chrome.storage.local.get ("crawlerIncognito", function (items) {
		incognito = items.crawlerIncognito == "on";
		if (incognito)
		    chrome.extension.isAllowedIncognitoAccess (function (allowed) {
			incognito = allowed;
			searchCrawlerTab (incognito, doOpen);
		    });
		else
		    searchCrawlerTab (incognito, doOpen);
	    });
	}

	function create ()
	{
	    // random delays 50-120 seconds
	    var delays = [];
	    for (var i = 0; i < 30; i++)
		delays.push (cmn.rdelay (50, 120));

	    // multiplier used for back-off
	    var delayMult = 1.0;

	    function backoff () {
		delayMult *= 1.5;
		if (delayMult > 5.0)
		    delayMult = 5.0;
	    }

	    function speedup () {
		delayMult = 1.0;
	    }

	    function retry () {
		backoff ();
		getJob ();
	    }

	    function getJob () {
		var r = Math.floor (Math.random () * delays.length);
		var d = delays[r] * delayMult;
		console.log ("Next job after "+d);

		function get ()
		{
		    cmn.getCrawlerAllowed (function (allowed) {
			if (!allowed)
			{
			    // retry later after the same delay
			    getJob ();
			}
			else
			{
			    // get the job
			    server.crawlerJob (function (data) {
				speedup ();
				open (data, getJob);
			    }, retry);
			}
		    });
		}

		cmn.later (d, get, retry);
	    }

	    return getJob;
	}

	function isCrawlerTabReady (message, sender)
	{
//	    return message.AdId == self.ad.AdId
	    return self.tab && sender.tab && self.tab == sender.tab.id;
	}

	function ready (message, sender, reply)
	{
	    if (!self.is_ready && isCrawlerTabReady (message, sender))
	    {
		self.is_ready = true;
		console.log ("Crawler tab ready");
		if (!reply ({type: "startCrawler"}))
		    callback ();
	    }
	    else
	    {
		console.log ("Tab ready");
		reply ();
	    }
	}

	function done ()
	{
	    console.log ("Crawler tab done");
	    clearTTL ();
	    callback ();
	}

	// public
	function start ()
	{
	    cmn.setEventListeners ({
		"crawlerOff": close,
		"parserDone": done,
		"ready": ready,
	    });

	    var crawler = create ();
	    crawler ();
	}

	window.sobnik.crawler.bg = {
	    start: start,
	}
    }

    function tabStart ()
    {
	console.log ("Loading crawler.tab");

	var board = sobnik.require ("boards/current");
	var parser = sobnik.require ("parser");
	
	function insertBanner () 
	{
	    // add signal so that plugin can find this tab 
	    // even when restarted
	    var div = document.createElement ('div');
	    div.id = crawlerTabSignal;
	    $("body").append (div);

	    var settingsUrl = chrome.extension.getURL ("settings.html");
	    var html = "<div id='sobnikCrawlerInfoDiv' "
		+ "style='position: fixed; left: 10%; top: 10%; "
		+ "border: 1px solid #aaa; background:rgba(220,220,220,0.9); "
		+ "width: 80%; height: 80%; z-index: 10000; "
		+ "padding: 20px 40px'>"
		+ "<a href='#' onclick=\"$('#sobnikCrawlerInfoDiv').hide (); return false;\" "
		+ "style='position: absolute; top: 10px; right: 10px'>X</a>"
		+ "<h1 style='font-size: 6em; text-align: center'>"
		+ "Тут работает S<span style='color:#2c3'>o</span>bnik!"
		+ "</h1>"
		+ "<h2 style='font-size: 2em; text-align: center'>"
		+ "Это не реклама, пожалуйста, прочитайте это сообщение."
		+ "</h2>"
		+ "<p style='font-size: larger'>У вас установлен <a href='http://sobnik.com' target='_blank'>плагин Sobnik</a>, который фильтрует риэлторов. Для работы плагину нужно анализировать содержимое объявлений. В день публикуется очень много объявлений, сбор их &mdash; ресурсоемкий процесс. Чтобы Sobnik мог оставаться <strong>бесплатным</strong>, теперь каждый пользователь сможет вносить вклад в общее дело. Чтобы узнать подробности &mdash; прочитайте <a href='http://sobnik.com/kak-rabotaet-sobnik.html' target='_blank'>инструкцию</a>.</p>"
		+ "<p style='font-size: larger; margin-top: 10px;'>В этой вкладке вашего браузера Sobnik будет сканировать объявления, и отправлять информацию в общую базу. Sobnik вам не помешает &mdash; он открывает не более одного объявления в минуту. Таким образом, без особых неудобств и усилий, Вы сможете помогать множеству людей по всей стране, а они в ответ будут помогать Вам.</p>"
		+ "<p style='font-size: larger; margin-top: 10px;'>Вам стоит отключить сбор объявлений в <a href='#' onclick=\"return false;\" id='sobnikShowSettings'>настройках</a>, если у вас не безлимитный доступ в Интернет. Там же можно настроить сканирование по расписанию.</p>"
		+ "<p style='font-size: larger; margin-top: 10px;'>Если у Вас есть предложения или вопросы, пожалуйста, пишите в нашей группе <a href='https://vk.com/sobnik_com' target='_blank'>Вконтакте</a>, или на электронную почту <strong>sobnik.ru@gmail.com</strong></p>"
		+ "<h2 style='font-size: 3em; text-align: center; margin-top: 30px;'>Спасибо!</h2>"
		+ "</div>";
	    
	    $("body").append (html);

	    // we may not inline the onclick into the html, as it will be
	    // executed in the context of web-site, not the extension.
	    // this way we add handler in the context of extension.
	    cmn.later (0, function () {
		$("#sobnikShowSettings").on ("click", function () {

		    // FIXME this should be abstracted away
		    // but currently we can't w/o creating cyclic dep-cy
		    chrome.runtime.sendMessage(
			/* ext_id= */"", 
			{type: "showSettings"}
		    );
		});
	    });
	}

	// public
	function start ()
	{
	    if (!sobnik.debugCrawler)
		insertBanner ();
	    parser.start ();
	}

	window.sobnik.crawler.tab = {
	    start: start
	}
    }

    window.sobnik.crawler = {
	bg: bgStart,
	tab: tabStart,
    }

}) ();

