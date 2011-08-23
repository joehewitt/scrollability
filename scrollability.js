/* See LICENSE for terms of usage */
(function() {

if (navigator.userAgent.toLowerCase().indexOf("msie")>=0) { return false; }

// Number of pixels finger must move to determine horizontal or vertical motion
var kLockThreshold = 10;

// Factor which reduces the length of motion by each move of the finger
var kTouchMultiplier = 1;

// Maximum velocity for motion after user releases finger
var kMaxVelocity = 720 / (window.devicePixelRatio||1);

// Rate of deceleration after user releases finger
var kDecelRate = 350;

// Percentage of the page which content can be overscrolled before it must bounce back
var kBounceLimit = 0.5;

// Rate of deceleration when content has overscrolled and is slowing down before bouncing back
var kBounceDecelRate = 600;

// Duration of animation when bouncing back
var kBounceTime = 90;

// Percentage of viewport which must be scrolled past in order to snap to the next page
var kPageLimit = 0.3;

// Velocity at which the animation will advance to the next page
var kPageEscapeVelocity = 50;

// Vertical margin of scrollbar
var kScrollbarMargin = 2;

// Time to scroll to top
var kScrollToTopTime = 200;

var isWebkit = "webkitTransform" in document.documentElement.style;
var isFirefox = "MozTransform" in document.documentElement.style;
var isTouch = "ontouchstart" in window;

// ===============================================================================================

var startX, startY, touchX, touchY, touchDown, touchMoved, onScrollEvt, useOnScrollEvt, justChangedOrientation;
var animationInterval = 0;
var touchTargets = [];

var scrollers = {
    'horizontal': createXTarget,
    'vertical': createYTarget
};

window.scrollability = {
    globalScrolling: false,
    scrollers: scrollers,
    useOnScrollEvt: false,

    flashIndicators: function() {
        var scrollables = document.querySelectorAll('.scrollable.vertical');
        for (var i = 0; i < scrollables.length; ++i) {
            scrollability.scrollTo(scrollables[i], 0, 0, 20, true);
        }
    },
    
    scrollToTop: function() {
        var scrollables = document.getElementsByClassName('scrollable');
        if (scrollables.length) {
            var scrollable = scrollables[0];
            if (scrollable.className.indexOf('vertical') != -1) {
                scrollability.scrollTo(scrollable, 0, 0, kScrollToTopTime);
            }
        }
    },

    scrollTo: function(element, x, y, animationTime, muteDelegate) {
        stopAnimation();

        var target = createTargetForElement(element);
        if (target) {
            if (muteDelegate) {
                target.delegate = null;
            }
            target = wrapTarget(target);
            touchTargets = [target];
            touchMoved = true;
            if (animationTime) {
                var orig = element[target.key];
                var dest = target.filter(x, y);
                var dir = dest - orig;
                var startTime = new Date().getTime();

                animationInterval = setInterval(function() {
                    var d = new Date().getTime() - startTime;
                    var pos = orig + ((dest-orig) * (d/animationTime));
                    if ((dir < 0 && pos < dest) || (dir > 0 && pos > dest)) {
                        pos = dest;
                    }
                    target.updater(pos);
                    if (pos == dest) {
                        clearInterval(animationInterval);
                        setTimeout(stopAnimation, 200);
                    }
                }, 20);
            } else {
                target.updater(y);
                stopAnimation();
            }
        }
    }
};

function onLoad() {
    scrollability.flashIndicators();
}

function onScroll(event) {
    setTimeout(function() {
        if (justChangedOrientation) {
            justChangedOrientation = false;
        } else if (isTouch) {
            scrollability.scrollToTop();
        }
    });
}

function addEvent(element, action, callback, bubble) {
	if (element.attachEvent) {
		element.attachEvent("on"+action, callback);
	} else if (element.addEventListener) {
		element.addEventListener(action, callback, bubble);
	}
}

function onOrientationChange(event) {
    justChangedOrientation = true;
}

function onTouchStart(event) {
    stopAnimation();

    var touchCandidate = event.target;
    var touch = event.touches[0];

    var touched = null;
    var startTime = new Date().getTime();

    touchX = startX = touch.clientX;
    touchY = startY = touch.clientY;
    touchDown = true;
    touchMoved = false;

    touchTargets = getTouchTargets(event.target, touchX, touchY, startTime);
    if (!touchTargets.length && !scrollability.globalScrolling) {
        return true;
    }

    var holdTimeout = setTimeout(function() {
        holdTimeout = 0;
        touched = setTouched(touchCandidate);
    }, 50);

    var d = document;
    addEvent(d, 'touchmove', onTouchMove, false);
    addEvent(d, 'touchend', onTouchEnd, false);

    animationInterval = setInterval(touchAnimation, 0);

    function onTouchMove(event) {
        event.preventDefault();
        touchMoved = true;

        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = 0;
        }
        if (touched) {
            releaseTouched(touched);
            touched = null;
        }
        var touch = event.touches[0];
        touchX = touch.clientX;
        touchY = touch.clientY;

        // Reduce the candidates down to the one whose axis follows the finger most closely
        if (touchTargets.length > 1) {
            for (var i = 0; i < touchTargets.length; ++i) {
                var target = touchTargets[i];
                if (target.disable && target.disable(touchX, touchY, startX, startY)) {
                    target.terminator();
                    touchTargets.splice(i, 1);
                    break;
                }
            }
        }

        try {
            touchTargets[0].pullToRefresh();
        } catch(e) {}
    }

    function onTouchEnd(event) {
        if (holdTimeout) {
            clearTimeout(holdTimeout);
            holdTimeout = 0;
        }

        // Simulate a click event when releasing the finger
        if (touched) {
            var evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 1);
            touched[0].dispatchEvent(evt);
            releaseTouched(touched);
        } else {
            try {
                touchTargets[0].pullToRefreshRelease();
            } catch(e) {}
        }

        d.removeEventListener('touchmove', onTouchMove, false);
        d.removeEventListener('touchend', onTouchEnd, false);
        touchDown = false;
    }
}

function wrapTarget(target, startX, startY, startTime) {
    var delegate = target.delegate;
    var constrained = target.constrained;
    var paginated = target.paginated;
    var viewport = target.viewport || 0;
    var scrollbar = target.scrollbar;
    var position = target.node[target.key];
    var min = target.min;
    var max = target.max;
    var absMin = min;
    var absMax = Math.round(max/viewport)*viewport;
    var pageSpacing = 0;
    var velocity = 0;
    var decelerating = 0;
    var decelOrigin, decelDelta;
    var bounceLimit = target.bounce;
    var pageLimit = viewport * kPageLimit;
    var lastTouch = startTouch = target.filter(startX, startY);
    var lastTime = startTime;
    var stillTime = 0;
    var stillThreshold = 20;
    var snapped = false;
    var locked = false;
    var isPullingUp = false;
    var isPullingDown = false;

    if (paginated) {
        var excess = Math.round(Math.abs(absMin) % viewport);
        var pageCount = ((Math.abs(absMin)-excess) / viewport)+1;
        var pageSpacing = excess / pageCount;

        var positionSpacing = Math.round(position) % viewport;
        var pagePosition = Math.round((position-positionSpacing)/viewport) * viewport;
        min = max = Math.round(pagePosition + absMax)+positionSpacing;
        absMin += pageSpacing;
    }

    if (delegate && delegate.onStartScroll) {
        if (!delegate.onStartScroll()) {
            return null;
        }
    }

    if (scrollbar) {
        target.node.parentNode.appendChild(scrollbar);
    }

    function animator(touch, time) {
        var deltaTime = 1 / (time - lastTime);
        lastTime = time;

        var continues = true;
        if (touchDown) {
            var delta = (touch - lastTouch) * kTouchMultiplier;
            if (!delta) {
                // Heuristics to prevent out delta=0 changes from making velocity=0 and
                // stopping all motion in its tracks.  We need to distinguish when the finger
                // has actually stopped moving from when the timer fired too quickly.
                if (!stillTime) {
                    stillTime = time;
                }
                if (time - stillTime < stillThreshold) {
                    return true;
                }
            } else {
                stillTime = 0;
            }

            if (!locked && Math.abs(touch - startTouch) > kLockThreshold) {
                locked = true;
                if (delegate && delegate.onLockScroll) {
                    delegate.onLockScroll(target.key);
                }
            }

            lastTouch = touch;
            velocity = delta / deltaTime;

            // Apply resistance along the edges
            if (position > max && constrained) {
                var excess = position - max;
                velocity *= (1.0 - excess / bounceLimit);
            } else if (position < min && constrained) {
                var excess = min - position;
                velocity *= (1.0 - excess / bounceLimit);
            }
        } else {
            if (paginated && !snapped) {
                // When finger is released, decide whether to jump to next/previous page
                // or to snap back to the current page
                snapped = true;
                if (Math.abs(position - max) > pageLimit || Math.abs(velocity) > kPageEscapeVelocity) {
                    if (position > max) {
                        if (max != absMax) {
                            max += viewport+pageSpacing;
                            min += viewport+pageSpacing;
                            if (delegate && delegate.onScrollPage) {
                                var totalSpacing = min % viewport;
                                var page = -Math.round((position+viewport-totalSpacing)/viewport);
                                delegate.onScrollPage(page, -1);
                            }
                        }
                    } else {
                        if (min != absMin) {
                            max -= viewport+pageSpacing;
                            min -= viewport+pageSpacing;
                            if (delegate && delegate.onScrollPage) {
                                var totalSpacing = min % viewport;
                                var page = -Math.round((position-viewport-totalSpacing)/viewport);
                                delegate.onScrollPage(page, 1);
                            }
                        }
                    }
                }
            }

            if (position > max && constrained) {
                if (velocity > 0) {
                    // Slowing down
                    var excess = position - max;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.max(velocity - kBounceDecelRate * deltaTime, 0) * elasticity;
                    decelerating = 0;
                } else {
                    // Bouncing back
                    if (!decelerating) {
                        decelOrigin = position;
                        decelDelta = max - position;
                    }

                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, kBounceTime);
                    return update(position, ++decelerating <= kBounceTime && Math.floor(position) > max);
                }
            } else if (position < min && constrained) {
                if (velocity < 0) {
                    // Slowing down
                    var excess = min - position;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.min(velocity + kBounceDecelRate * deltaTime, 0) * elasticity;
                    decelerating = 0;
                } else {
                    // Bouncing back
                    if (!decelerating) {
                        decelOrigin = position;
                        decelDelta = min - position;
                    }
                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, kBounceTime);
                    return update(position, ++decelerating <= kBounceTime && Math.ceil(position) < min);
                }
            } else {
                // Slowing down
                if (!decelerating) {
                    if (velocity < 0 && velocity < -kMaxVelocity) {
                        velocity = -kMaxVelocity;
                    } else if (velocity > 0 && velocity > kMaxVelocity) {
                        velocity = kMaxVelocity;
                    }
                    decelOrigin = velocity;
                }

                velocity = easeOutExpo(decelerating, decelOrigin, -decelOrigin, kDecelRate);

                if (++decelerating > kDecelRate || Math.floor(velocity) == 0) {
                    continues = false;
                }
            }
        }

        position += velocity * deltaTime;
        return update(position, continues);
    }

    function update(pos, continues) {
        position = pos;

        target.node[target.key] = position;
        target.update(target.node, position);

        if (delegate && delegate.onScroll) {
            delegate.onScroll(position);
        }

        // Update the scrollbar
        var range = -min - max;
        if (scrollbar && (range + viewport) > viewport) {
            var viewable = viewport - kScrollbarMargin*2;
            var height = (viewable/(range+viewport)) * viewable;
            var scrollPosition = 0;
            if (position > max) {
                height = Math.max(height - (position-max), 5);
                scrollPosition = 0;
            } else if (position < min) {
                height = Math.max(height - (min - position), 5);
                scrollPosition = (viewable-height);
            } else {
                scrollPosition = Math.round((Math.abs(position) / range) * (viewable-height));
            }
            scrollPosition += kScrollbarMargin;
            scrollbar.style.height = Math.round(height) + 'px';

            moveElement(scrollbar, 0, Math.round(scrollPosition));

            if (touchMoved) {
                scrollbar.style.webkitTransition = 'none';
                scrollbar.style.opacity = '1';
            }
        }

        return continues;
    }

    function terminator() {
        // Snap to the integer endpoint, since position may be a subpixel value while animating
        if (paginated) {
            var pageIndex = Math.round(position/viewport);
            update(pageIndex * (viewport+pageSpacing));
        } else  if (position > max && constrained) {
            update(max);
        } else if (position < min && constrained) {
            update(min);
        }

        // Hide the scrollbar
        if (scrollbar) {
            scrollbar.style.opacity = '0';
            scrollbar.style.webkitTransition = 'opacity 0.33s linear';
        }
        if (delegate && delegate.onEndScroll) {
            delegate.onEndScroll();
        }
    }

    function pullToRefresh(released) {
        var pullUpMin = min - target.pullUpToRefresh.offsetHeight / 2;
        var pullDownMin = max + target.pullDownToRefresh.offsetHeight;
        var pullState;
        
        return function() {
            if (target.pullUpToRefresh || target.pullDownToRefresh) {
                if ( !released && 
                        (
                            (isPullingDown && ((pullDownMin < position && pullState) || (pullDownMin > position && !pullState)))
                            || 
                            (isPullingUp && ((position < pullUpMin && pullState) || (position > pullUpMin && !pullState)))
                        )
                ) {
                    return;
                }
                
                if (released && (position > pullDownMin)) {
                    pullState = 'pulledDown';
                    isPullingUp = false;
                    isPullingDown = false;
                } else if (released && (position < pullUpMin)) {
                    pullState = 'pulledUp';
                    isPullingUp = false;
                    isPullingDown = false;
                } else if (isPullingDown && (position < pullDownMin)) {
                    pullState = 'pullDownCancel';
                    isPullingUp = false;
                    isPullingDown = false;
                } else if (isPullingUp && (position > pullUpMin)) {
                    pullState = 'pullUpCancel';
                    isPullingUp = false;
                    isPullingDown = false;
                } else if (position > pullDownMin) {
                    pullState = 'pullingDown';
                    isPullingUp = false;
                    isPullingDown = true;
                } else if (position < pullUpMin) {
                    pullState = 'pullingUp';
                    isPullingUp = true;
                    isPullingDown = false;
                }
                
                var evt = document.createEvent('Event');
                evt.initEvent(pullState, true, false);
                target.node.dispatchEvent(evt);
            }
        }
    }

    target.updater = update;
    target.animator = animator;
    target.terminator = terminator;
    target.pullToRefresh = pullToRefresh(false);
    target.pullToRefreshRelease = pullToRefresh(true);
    return target;
}

function touchAnimation() {
    var time = new Date().getTime();

    // Animate each of the targets
    for (var i = 0; i < touchTargets.length; ++i) {
        var target = touchTargets[i];

        // Translate the x/y touch into the value needed by each of the targets
        var touch = target.filter(touchX, touchY);
        if (!target.animator(touch, time)) {
            target.terminator();
            touchTargets.splice(i--, 1);
        }
    }

    if (!touchTargets.length) {
        stopAnimation();
    }
}

// *************************************************************************************************

function getTouchTargets(node, touchX, touchY, startTime) {
    var targets = [];
    findTargets(node, targets, touchX, touchY, startTime);

    var candidates = document.querySelectorAll('.scrollable.global');
    for(var j = 0; j < candidates.length; ++j) {
        findTargets(candidates[j], targets, touchX, touchY, startTime);
    }
    return targets;
}

function findTargets(element, targets, touchX, touchY, startTime) {
    while (element) {
        if (element.nodeType == 1) {
            var target = createTargetForElement(element, touchX, touchY, startTime);
            if (target) {
                // Look out for duplicates
                var exists = false;
                for (var j = 0; j < targets.length; ++j) {
                    if (targets[j].node == element) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    target = wrapTarget(target, touchX, touchY, startTime);
                    if (target) {
                        targets.push(target);
                    }
                }
            }
        }
        element = element.parentNode;
    }
}

function createTargetForElement(element, touchX, touchY, startTime) {
    var classes = element.className.split(' ');
    for (var i = 0; i < classes.length; ++i) {
        var name = classes[i];
        if (scrollers[name]) {
            var target = scrollers[name](element);
            target.key = 'scrollable_'+name;
            target.paginated = classes.indexOf('paginated') != -1;
            if (!(target.key in element)) {
                element[target.key] = target.initial ? target.initial(element) : 0;
            }
            return target;
        }
    }
}

function setTouched(target) {
    var touched = [];
    for (var n = target; n; n = n.parentNode) {
        if (n.nodeType == 1) {
            n.className = (n.className ? n.className + ' ' : '') + 'touched';
            touched.push(n);
        }
    }
    return touched;
}

function releaseTouched(touched) {
    for (var i = 0; i < touched.length; ++i) {
        var n = touched[i];
        n.className = n.className.replace('touched', '');
    }
}

function stopAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = 0;

        for (var i = 0; i < touchTargets.length; ++i) {
            var target = touchTargets[i];
            target.terminator();
        }
        touchTargets = [];
    }
}

function moveElement(element, x, y) {
    if (isWebkit) {
        element.style.webkitTransform = 'translate3d('
            +(x ? (x+'px') : '0')+','
            +(y ? (y+'px') : '0')+','
            +'0)';
    } else if (isFirefox) {
        element.style.MozTransform = 'translate3d('
            +(x ? (x+'px') : '0')+','
            +(y ? (y+'px') : '0')+')';
    }

    if(!onScrollEvt && useOnScrollEvt) {
        onScrollEvt = setTimeout(function() {
            var evt = document.createEvent('Event');
            // Don't want this to bubble because of scrollToTop
            evt.initEvent('scroll', false, false);
            evt.x = -x || 0;
            evt.y = -y || 0;
            element.dispatchEvent(evt);
            onScrollEvt = false;
        }, 20);
    }
}

function initScrollbar(element) {
    if (!element.scrollableScrollbar) {
        var scrollbar = element.scrollableScrollbar = document.createElement('div');
        scrollbar.className = 'scrollableScrollbar';

        // We hardcode this CSS here to avoid having to provide a CSS file
        scrollbar.style.cssText = [
            'position: absolute',
            'top: 0',
            'right: 2px',
            'width: 5px',
            'min-height: 4px',
            'background: rgba(40, 40, 40, 0.6)',
            'border: 1px solid rgba(235, 235, 235, 0.1)',
            'opacity: 0',
            '-webkit-border-radius: 4px 5px',
            '-webkit-transform: translate3d(0,0,0)',
            '-webkit-box-sizing: border-box',
            'z-index: 2147483647'
        ].join(';');
    }
    return element.scrollableScrollbar;
}

function easeOutExpo(t, b, c, d) {
    return (t==d) ? b+c : c * (-Math.pow(2, -10 * t/d) + 1) + b;
}

// *************************************************************************************************

function createXTarget(element) {
    var parent = element.parentNode;
    return {
        node: element,
        min: -parent.scrollWidth + parent.offsetWidth,
        max: 0,
        viewport: parent.offsetWidth,
        bounce: parent.offsetWidth * kBounceLimit,
        constrained: true,
        delegate: element.scrollDelegate,

        filter: function(x, y) {
            return x;
        },

        disable: function (x, y, startX, startY) {
            var dx = Math.abs(x - startX);
            var dy = Math.abs(y - startY);
            if (dy > dx && dy > kLockThreshold) {
                return true;
            }
        },

        update: function(element, position) {
            moveElement(element, position, element.scrollable_vertical||0);
        }
    };
}

function createYTarget(element) {
    var parent = element.parentNode,
        pullDownToRefresh = parent.getElementsByClassName('pull-down-to-refresh')[0];
        pullUpToRefresh = parent.getElementsByClassName('pull-up-to-refresh')[0];
    return {
        node: element,
        scrollbar: initScrollbar(element),
        min: -parent.scrollHeight + parent.offsetHeight
             + (pullUpToRefresh ? pullUpToRefresh.offsetHeight : 0),
        max: (pullDownToRefresh ? -pullDownToRefresh.offsetHeight : 0),
        viewport: parent.offsetHeight,
        bounce: parent.offsetHeight * kBounceLimit,
        pullUpToRefresh: pullUpToRefresh ? pullUpToRefresh : false,
        pullDownToRefresh: pullDownToRefresh ? pullDownToRefresh : false,
        constrained: true,
        delegate: element.scrollDelegate,

        filter: function(x, y) {
            return y;
        },

        disable: function(x, y, startX, startY) {
            var dx = Math.abs(x - startX);
            var dy = Math.abs(y - startY);
            if (dx > dy && dx > kLockThreshold) {
                return true;
            }
        },

        update: function(element, position) {
            moveElement(element, element.scrollable_horizontal||0, position);
        }
    };
}

addEvent(document, 'touchstart', onTouchStart, false);
addEvent(document, 'scroll', onScroll, false);
addEvent(document, 'orientationchange', onOrientationChange, false);
addEvent(window, 'load', onLoad, false);

})();
