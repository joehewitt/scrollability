/* See LICENSE for terms of usage */

"style scrollability/scrollbar.css"

var logs = [];

function D() {
    var args = []; args.push.apply(args, arguments);
    // console.log(args.join(' '));
    logs.push(args.join(' '));
}

window.showLog = function() {
    document.querySelector('.scrollable').innerHTML = logs.join('<br>');
}

// *************************************************************************************************

var isWebkit = "webkitTransform" in document.documentElement.style;
var isiOS5 = isWebkit && /OS 5_/.exec(navigator.userAgent);
var isTouch = "ontouchstart" in window;

// *************************************************************************************************

var kAnimationStep = 4;

var kFrameGranularity = 24;

var kFriction = 0.99;

// Number of pixels finger must move to determine horizontal or vertical motion
var kLockThreshold = 10;

// Percentage of the page which content can be overscrolled before it must bounce back
var kBounceLimit = 0.6;

// Rate of deceleration when content has overscrolled and is slowing down before bouncing back
var kBounceDecelRate = 0.01;

// Duration of animation when bouncing back
var kBounceTime = 220;
var kPageBounceTime = 60;

// Percentage of viewport which must be scrolled past in order to snap to the next page
var kPageLimit = 0.5;

// Velocity at which the animation will advance to the next page
var kPageEscapeVelocity = 50;

// Vertical margin of scrollbar
var kScrollbarMargin = 1;

// Time to scroll to top
var kScrollToTopTime = 200;

// *************************************************************************************************

var startX, startY, touchX, touchY, touchMoved, justChangedOrientation;
var animationInterval = 0;
var touchAnimators = [];
var animationIndex = 0;

var directions = {
    'horizontal': createXDirection,
    'vertical': createYDirection
};

exports.globalScrolling = false;
exports.directions = directions;

exports.flashIndicators = function() {
    var scrollables = document.querySelectorAll('.scrollable.vertical');
    for (var i = 0; i < scrollables.length; ++i) {
        exports.scrollTo(scrollables[i], 0, 0, 20, true);
    }            
}

exports.scrollToTop = function() {
    var scrollables = document.getElementsByClassName('scrollable');
    if (scrollables.length) {
        var scrollable = scrollables[0];
        if (scrollable.className.indexOf('vertical') != -1) {
            exports.scrollTo(scrollable, 0, 0, kScrollToTopTime);
        }
    }
}

exports.scrollTo = function(element, x, y, animationTime) {
    stopAnimation();

    var animator = createAnimatorForElement(element);
    if (animator) {
        animator.mute = true;
        animator = wrapAnimator(animator);
        touchAnimators = [animator];
        touchMoved = true;
        if (animationTime) {
            var orig = animator.position;
            var dest = animator.filter(x, y);
            var dir = dest - orig;
            var startTime = new Date().getTime();
            animationInterval = setInterval(function() {
                var d = new Date().getTime() - startTime;
                var pos = orig + ((dest-orig) * (d/animationTime));
                if ((dir < 0 && pos < dest) || (dir > 0 && pos > dest)) {
                    pos = dest;
                }
                animator.reposition(pos);
                if (pos == dest) {
                    clearInterval(animationInterval);
                    setTimeout(stopAnimation, 200);
                }
            }, 20);
        } else {
            animator.updater(y);
            stopAnimation();
        }
    }
}

function onLoad() {
    exports.flashIndicators();
}

function onScroll(event) {
    setTimeout(function() {
        if (justChangedOrientation) {
            justChangedOrientation = false;
        } else if (isTouch) {
            exports.scrollToTop();
        }        
    });
}

function onOrientationChange(event) {
    justChangedOrientation = true;
}

function onTouchStart(event) {
    stopAnimation();

    var touch = event.touches[0];
    var touched = null;

    touchX = startX = touch.clientX;
    touchY = startY = touch.clientY;
    touchMoved = false;

    touchAnimators = getTouchAnimators(event.target, touchX, touchY, event.timeStamp);
    if (!touchAnimators.length && !exports.globalScrolling) {
        return true;
    }
    
    var d = document;
    d.addEventListener('touchmove', onTouchMove, false);
    d.addEventListener('touchend', onTouchEnd, false);

    function onTouchMove(event) {
        event.preventDefault();
        touchMoved = true;

        if (touched) {
            releaseTouched(touched);
            touched = null;
        }

        var touch = event.touches[0];
        touchX = touch.clientX;
        touchY = touch.clientY;

        // Reduce the candidates down to the one whose axis follows the finger most closely
        if (touchAnimators.length > 1) {
            for (var i = 0; i < touchAnimators.length; ++i) {
                var animator = touchAnimators[i];
                if (animator.disable && animator.disable(touchX, touchY, startX, startY)) {
                    animator.terminate();
                    touchAnimators.splice(i--, 1);

                    if (touchAnimators.length == 1) {
                        dispatch("scrollability-lock", animator.node, {direction: animator.direction});
                    }
                }
            }
        }

        touchAnimation(event.timeStamp, true);
    }

    function onTouchEnd(event) {
        // Simulate a click event when releasing the finger
        if (touched) {
            var evt = document.createEvent('MouseEvents'); 
            evt.initMouseEvent('click', true, true, window, 1);
            touched[0].dispatchEvent(evt); 
            releaseTouched(touched);
        }
        
        d.removeEventListener('touchmove', onTouchMove, false);
        d.removeEventListener('touchend', onTouchEnd, false);

        touchAnimation(event.timeStamp);
    }
}

function wrapAnimator(animator, startX, startY, startTime) {
    // XXXjoe This stuff only needs to be done if animation was running when touch began
    animator.node.style.webkitAnimationPlayState = "paused";
    reposition(animator.position);

    var constrained = animator.constrained;
    var paginated = animator.paginated;
    var viewport = animator.viewport || 0;
    var scrollbar = animator.scrollbar;
    var position = animator.position;
    var min = animator.min;
    var max = animator.max;
    var absMin = min;
    var absMax = Math.round(max/viewport)*viewport;
    var pageSpacing = 0;
    var velocity = 0;
    var bounceTime = paginated ? kPageBounceTime : kBounceTime;
    var bounceLimit = animator.bounce;
    var pageLimit = viewport * kPageLimit;
    var lastTouch = startTouch = animator.filter(startX, startY);
    var lastTime = startTime;
    var timeStep = 0;
    var snapped = false;
    
    if (paginated) {
        var excess = Math.round(Math.abs(absMin) % viewport);
        var pageCount = ((Math.abs(absMin)-excess) / viewport)+1;
        var pageSpacing = excess / pageCount;

        var positionSpacing = Math.round(position) % viewport;
        var pagePosition = Math.round((position-positionSpacing)/viewport) * viewport;
        min = max = Math.round(pagePosition + absMax)+positionSpacing;
        absMin += pageSpacing;
    }

    if (!animator.mute) {
        if (!dispatch("scrollability-start", animator.node)) {
            return null;        
        }
    }

    if (scrollbar) {
        animator.node.parentNode.appendChild(scrollbar);
    }
    
    function track(touch, time) {
        timeStep = time - lastTime;
        lastTime = time;

        velocity = touch - lastTouch;
        lastTouch = touch;
                
        // Apply resistance along the edges
        if (constrained) {
            if (position > max && absMax == max) {
                var excess = position - max;
                velocity *= (1.0 - excess / bounceLimit);
            } else if (position < min && absMin == min) {
                var excess = min - position;
                velocity *= (1.0 - excess / bounceLimit);
            }
        }

        position += velocity;
        reposition(position);
        animator.node.style.webkitAnimationName = '';
        return true;
    }

    function takeoff() {
        position += velocity;
        reposition(position);

        velocity = (velocity/timeStep) * kAnimationStep;

        var keyframes = createKeyframes();

        var ss = document.styleSheets[0];
        var ruleIndex = ss.rules.length;
        var rule = ss.insertRule(keyframes.css, ruleIndex);

        var oldCleanup = animator.node.cleanup;
        var cleanup = animator.node.cleanup = function(event, noSync) {
            delete animator.node.cleanup;
            ss.deleteRule(ruleIndex);
        }
        
        animator.node.style.webkitAnimation = keyframes.name + " " + keyframes.time + "ms linear both";
        animator.node.style.webkitAnimationPlayState = "running";

        if (oldCleanup) {
            oldCleanup();
        }        
    }

    function createKeyframes() {
        var time = 0;
        var lastPosition = position;
        var lastKeyTime = 0;
        var lastDiff = 0;
        var decelOrigin;
        var decelDelta;
        var decelStep = 0;
        var keyframes = [];

        var continues = true;
        while (continues) {
            if (position > max && constrained) {
                if (velocity > 0) {
                    // Slowing down
                    var excess = position - max;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.max(velocity - kBounceDecelRate, 0) * elasticity;
                    position += velocity;
                } else {
                    // Bouncing back
                    if (!decelStep) {
                        decelOrigin = position;
                        decelDelta = max - position;
                    }

                    position = easeOutExpo(decelStep, decelOrigin, decelDelta, bounceTime);
                    continues = ++decelStep <= bounceTime && Math.floor(Math.abs(position)) > max;
                }
            } else if (position < min && constrained) {
                if (velocity < 0) {
                    // Slowing down
                    var excess = min - position;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.min(velocity + kBounceDecelRate, 0) * elasticity;
                    position += velocity;
                } else {
                    // Bouncing back
                    if (!decelStep) {
                        decelOrigin = position;
                        decelDelta = min - position;
                    }
                    position = easeOutExpo(decelStep, decelOrigin, decelDelta, bounceTime);
                    continues = ++decelStep <= bounceTime && Math.ceil(position) < min;
                }
            } else {
                velocity *= kFriction;
                position += velocity;
                continues = Math.floor(Math.abs(velocity)*100) > 0;
            }

            saveKeyframe(position);            

            time += kAnimationStep;
        }

        var totalTime = keyframes[keyframes.length-1].time;

        var name = "scrollability" + (animationIndex++);
        var css = generateCSSKeyframes(keyframes, name, totalTime);
        return {name: name, time: totalTime, position: position, css: css};

        function saveKeyframe(pos) {
            var diff = position - lastPosition;
            // Add a new frame when we've changed direction, or passed the prescribed granularity
            if (time-lastKeyTime >= kFrameGranularity || (lastDiff < 0 != diff < 0)) {
                keyframes.push({position: position, time: time});

                lastDiff = diff;
                lastPosition = position;
                lastKeyTime = time;
            }
        }
    }

    function reposition(pos) {
        position = pos;
        animator.update(animator.node, position);

        if (!dispatch("scrollability-scroll", animator.node,
            {direction: animator.direction, position: position})) {
            return;
        }

        // Update the scrollbar
        var range = -min - max;
        if (scrollbar && viewport < range) {
            var viewable = viewport - kScrollbarMargin*2;
            var height = (viewable/range) * viewable;
            var scrollPosition = 0;
            if (position > max) {
                height = Math.max(height - (position-max), 7);
                scrollPosition = 0;
            } else if (position < min) {
                height = Math.max(height - (min - position), 7);
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
    }
    
    function terminate() {
        // Hide the scrollbar
        if (scrollbar) {
            scrollbar.style.opacity = '0';
            scrollbar.style.webkitTransition = 'opacity 0.33s linear';
        }
        if (!animator.mute) {
            dispatch("scrollability-end", animator.node);
        }
    }
    
    animator.reposition = reposition;
    animator.track = track;
    animator.takeoff = takeoff;
    animator.terminate = terminate;
    return animator;
}

function touchAnimation(time, touchDown) {
    // Animate each of the animators
    for (var i = 0; i < touchAnimators.length; ++i) {
        var animator = touchAnimators[i];

        // Translate the x/y touch into the value needed by each of the animators
        var touch = animator.filter(touchX, touchY);
        if (touchDown) {
            animator.track(touch, time);
        } else {
            animator.takeoff();
            touchAnimators.splice(i--, 1);
        }
        // if (!animator.track(touch, time)) {
        //     animator.terminate();
        //     touchAnimators.splice(i--, 1);
        // }
    }
    
    if (!touchAnimators.length) {
        stopAnimation();
    }
}

// *************************************************************************************************

function getTouchAnimators(node, touchX, touchY, startTime) {
    var animators = [];
    
    // Find scrollable nodes that were directly touched
    findAnimators(node, animators, touchX, touchY, startTime);

    // Get universally scrollable elements
    var candidates = document.querySelectorAll('.scrollable.global');
    for (var j = 0; j < candidates.length; ++j) {
        findAnimators(candidates[j], animators, touchX, touchY, startTime);
    }

    return animators;
}

function findAnimators(element, animators, touchX, touchY, startTime) {
    while (element) {
        if (element.nodeType == 1) {
            var animator = createAnimatorForElement(element, touchX, touchY, startTime);
            if (animator) {
                // Look out for duplicates
                var exists = false;
                for (var j = 0; j < animators.length; ++j) {
                    if (animators[j].node == element) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    animator = wrapAnimator(animator, touchX, touchY, startTime);
                    if (animator) {
                        animators.push(animator);                            
                    }
                }
            }
        }
       element = element.parentNode;
    }
}

function createAnimatorForElement(element, touchX, touchY, startTime) {
    var classes = element.className.split(' ');
    if (classes.indexOf("scrollable") == -1)
        return;
    
    for (var i = 0; i < classes.length; ++i) {
        var name = classes[i];
        if (directions[name]) {
            var animator = directions[name](element);
            animator.direction = name;
            animator.paginated = classes.indexOf('paginated') != -1;
            animator.position = animator.initial(element);
            return animator;
        }
    }
}

function generateCSSKeyframes(keyframes, name, time) {
    var lines = ['@-webkit-keyframes ' + name + ' {'];

    keyframes.forEach(function(keyframe) {
        var percent = (keyframe.time / time) * 100;
        var keyframe = percent + '% {'
            + '-webkit-transform: translate3d(0, ' + keyframe.position + 'px, 0);'
            + '}';
        lines.push(keyframe);
    });

    lines.push('}');

    return lines.join('\n');    
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

        for (var i = 0; i < touchAnimators.length; ++i) {
            var animator = touchAnimators[i];
            animator.terminate();
        }
        touchAnimators = [];
    }
}

function moveElement(element, x, y) {
    element.style.webkitTransform = 'translate3d('
    +(x ? (x+'px') : '0')+','
    +(y ? (y+'px') : '0')+','
    +'0)';      
}

function initScrollbar(element) {
    if (!element.scrollableScrollbar) {
        var scrollbar = element.scrollableScrollbar = document.createElement('div');
        scrollbar.className = 'scrollability-scrollbar';
    }
    return element.scrollableScrollbar;
}

function easeOutExpo(t, b, c, d) {
    return (t==d) ? b+c : c * (-Math.pow(2, -10 * t/d) + 1) + b;
}

// *************************************************************************************************

function createXDirection(element) {
    var parent = element.parentNode;
    var baseline = isiOS5 ? (element.scrollable_horizontal||0) : 0;

    return {
        node: element,
        min: (-parent.scrollWidth+baseline) + parent.offsetWidth,
        max: 0,
        viewport: parent.offsetWidth,
        bounce: parent.offsetWidth * kBounceLimit,
        constrained: true,
        
        initial: function(element) {
            var transform = getComputedStyle(element).webkitTransform;
            return new WebKitCSSMatrix(transform).m41;
        },

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

function createYDirection(element) {
    var parent = element.parentNode;
    var baseline = 0;//isiOS5 ? (element.scrollable_vertical||0) : 0;

    return {
        node: element,
        scrollbar: initScrollbar(element),
        min: (-parent.scrollHeight+baseline) + parent.offsetHeight,
        max: 0,
        viewport: parent.offsetHeight,
        bounce: parent.offsetHeight * kBounceLimit,
        constrained: true,
        
        initial: function(element) {
            var transform = getComputedStyle(element).webkitTransform;
            return new WebKitCSSMatrix(transform).m42;
        },

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

function dispatch(name, target, props) {
    var e = document.createEvent("Events");
    e.initEvent(name, true, true);

    if (props) {
        for (var name in props) {
            e[name] = props[name];
        }
    }

    return target.dispatchEvent(e);
}

require.ready(function() {
    document.addEventListener('touchstart', onTouchStart, false);
    // document.addEventListener('scroll', onScroll, false);
    document.addEventListener('orientationchange', onOrientationChange, false);
    window.addEventListener('load', onLoad, false);
});
