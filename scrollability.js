/* See LICENSE for terms of usage */

"style scrollability/scrollbar.css"

// var logs = [];

// function D() {
//     var args = []; args.push.apply(args, arguments);
//     console.log(args.join(' '));
//     // logs.push(args.join(' '));
// }

// window.showLog = function() {
//     document.querySelector('.scrollable').innerHTML = logs.join('<br>');
//     document.querySelector('.scrollable').style.webkitAnimation = '';
//     document.querySelector('.scrollable').style.webkitTransform = 'translate3d(0,0,0)';
// }

// *************************************************************************************************

var isWebkit = "webkitTransform" in document.documentElement.style;
var isiOS5 = isWebkit && /OS 5_/.exec(navigator.userAgent);
var isTouch = "ontouchstart" in window;

// *************************************************************************************************

// The friction applied while decelerating
var kFriction = 0.9925;

// If the velocity is below this threshold when the finger is released, animation will stop
var kStoppedThreshold = 4;

// Number of pixels finger must move to determine horizontal or vertical motion
var kLockThreshold = 10;

// Percentage of the page which content can be overscrolled before it must bounce back
var kBounceLimit = 0.75;

// Rate of deceleration when content has overscrolled and is slowing down before bouncing back
var kBounceDecelRate = 0.01;

// Duration of animation when bouncing back
var kBounceTime = 240;
var kPageBounceTime = 160;

// Percentage of viewport which must be scrolled past in order to snap to the next page
var kPageLimit = 0.5;

// Velocity at which the animation will advance to the next page
var kPageEscapeVelocity = 2;

// Vertical margin of scrollbar
var kScrollbarMargin = 2;

// The width or height of the scrollbar along the animated axis
var kScrollbarSize = 7;

// The number of milliseconds to increment while simulating animation
var kAnimationStep = 4;

// The number of milliseconds of animation to condense into a keyframe
var kKeyframeIncrement = 24;

// *************************************************************************************************

var startX, startY, touchX, touchY, touchMoved;
var animationInterval = 0;
var touchAnimators = [];
var animationIndex = 0;
var globalStyleSheet;

var directions = {
    'horizontal': createXDirection,
    'vertical': createYDirection
};

exports.directions = directions;

exports.flashIndicators = function() {
    // var scrollables = document.querySelectorAll('.scrollable.vertical');
    // for (var i = 0; i < scrollables.length; ++i) {
    //     exports.scrollTo(scrollables[i], 0, 0, 20, true);
    // }            
}

function onLoad() {
    var ss = document.createElement("style");
    document.head.appendChild(ss);
    globalStyleSheet = document.styleSheets[document.styleSheets.length-1];

    // exports.flashIndicators();
}

require.ready(function() {
    document.addEventListener(isTouch ? 'touchstart' : 'mousedown', onTouchStart, false);
    window.addEventListener('load', onLoad, false);
});

function onTouchStart(event) {
    var touch = isTouch ? event.touches[0] : event;
    var touched = null;

    touchX = startX = touch.clientX;
    touchY = startY = touch.clientY;
    touchMoved = false;

    touchAnimators = getTouchAnimators(event.target, touchX, touchY, event.timeStamp);
    if (!touchAnimators.length) {
        return true;
    }

    var touchCandidate = event.target;
    var holdTimeout = setTimeout(function() {
        holdTimeout = 0;
        touched = setTouched(touchCandidate);
    }, 50);

    document.addEventListener(isTouch ? 'touchmove' : 'mousemove', onTouchMove, false);
    document.addEventListener(isTouch ? 'touchend' : 'mouseup', onTouchEnd, false);

    // if (D) event.preventDefault();
        
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

        var touch = isTouch ? event.touches[0] : event;
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
                        var locked = touchAnimators[0];
                        dispatch("scrollability-lock", locked.node, {direction: locked.direction});
                    }
                }
            }
        }

        touchAnimators.forEach(function(animator) {
            var touch = animator.filter(touchX, touchY);
            animator.track(touch, event.timeStamp);
        });
    }

    function onTouchEnd(event) {
        // Simulate a click event when releasing the finger
        if (touched) {
            var evt = document.createEvent('MouseEvents'); 
            evt.initMouseEvent('click', true, true, window, 1);
            touched[0].dispatchEvent(evt); 
            releaseTouched(touched);
        }

        document.removeEventListener(isTouch ? 'touchmove' : 'mousemove', onTouchMove, false);
        document.removeEventListener(isTouch ? 'touchend' : 'mouseup', onTouchEnd, false);
        
        touchAnimators.forEach(function(animator) {
            animator.takeoff();
        });
    }
}

function wrapAnimator(animator, startX, startY, startTime) {
    var node = animator.node;
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
    var stopped = 0;
    var tracked = [];
    var offset = node.scrollableOffset||0;

    if (!animator.mute) {
        var event = {
            position: position,
            min: min,
            max: max,
            track: addTracker,
            setSpacing: setSpacing,
            setOffset: setOffset,
            setBounds: setBounds
        };
        if (!dispatch("scrollability-start", node, event)) {
            return null;
        }
    }

    if (paginated) {
        if (pageSpacing === undefined) {
            var excess = Math.round(Math.abs(absMin) % viewport);
            var pageCount = ((Math.abs(absMin)-excess) / viewport)+1;
            pageSpacing = excess / pageCount;
        }

        var pageIndex = Math.round(position/(viewport+pageSpacing));
        min = max = pageIndex * (viewport+pageSpacing);
        absMin += pageSpacing;
    }

    if (scrollbar) {
        addTracker(scrollbar, trackScrollbar);
        if (!scrollbar.parentNode) {
            node.parentNode.appendChild(scrollbar);            
        }
    }

    if (node.earlyEnd) {
        play(node);
        tracked.forEach(function(item) {
            play(item.node);
        });

        node.earlyEnd();

        update(position);
    }
        
    animator.reposition = update;
    animator.track = track;
    animator.takeoff = takeoff;
    animator.terminate = terminate;
    return animator;
    
    function addTracker(node, callback) {
        tracked.push({node: node, callback: callback, keyframes: []});
    }

    function setSpacing(x) {
        pageSpacing = x
    }

    function setOffset(x) {
        offset = x;

        track(lastTouch, lastTime);
    }

    function setBounds(newMin, newMax) {
        min = newMin;
        max = newMax;
    }

    function track(touch, time) {
        timeStep = time - lastTime;
        lastTime = time;

        velocity = touch - lastTouch;
        lastTouch = touch;
        
        if (Math.abs(velocity) >= kStoppedThreshold) {
            if (stopped) {
                --stopped;
            }
            stopped = 0;
        } else {
            ++stopped;
        }

        // Apply resistance along the edges
        if (constrained) {
            if (position > max && absMax == max) {
                var excess = position - max;
                velocity *= (1.0 - excess / bounceLimit)*kBounceLimit;
            } else if (position < min && absMin == min) {
                var excess = min - position;
                velocity *= (1.0 - excess / bounceLimit)*kBounceLimit;
            }
        }

        position += velocity;

        update(position);

        node.style.webkitAnimationName = '';
        tracked.forEach(function(item) {
            item.node.style.webkitAnimationName = '';
        });
        return true;
    }

    function trackScrollbar(position) {
        var range = max - min;
        if (scrollbar && min < 0) {
            var viewable = viewport - kScrollbarMargin*2;
            var height = (viewable/(range+viewport)) * viewable;
            var scrollPosition;
            if (position > max) {
                height = Math.max(height - (position-max), kScrollbarSize);
                scrollPosition = 0;
            } else if (position < min) {
                var h = height - (min - position);
                height = Math.max(height - (min - position), kScrollbarSize);
                scrollPosition = viewable-height;
            } else {
                scrollPosition = (Math.abs((max-position)) / range) * (viewable-height);
            }
            scrollPosition += kScrollbarMargin;

            return 'translate3d(0, ' + Math.round(scrollPosition) + 'px,  0) '
                   + 'scaleY(' + Math.round(height) + ')';
        }
    }

    function takeoff() {
        dispatch("scrollability-takeoff", node, {
            position: position,
            min: min,
            max: max,
            setBounds: setBounds
        });

        if (stopped) {
            velocity = 0;
        }

        position += velocity;
        update(position);

        velocity = (velocity/timeStep) * kAnimationStep;

        var timeline = createTimeline();
        if (!timeline.time) {
            terminate();
            return;
        }

        dispatch("scrollability-animate", node, {
            direction: animator.direction,
            time: timeline.time,
            keyframes: timeline.keyframes
        });

        if (node.cleanup) {
            node.cleanup();
        }        

        globalStyleSheet.insertRule(timeline.css, 0);

        tracked.forEach(function(item, i) {
            item.name = 'scrollability-track'+(animationIndex++);
            var css = generateCSSKeyframes(animator, item.keyframes, item.name, timeline.time);
            globalStyleSheet.insertRule(css, 0);
        });

        node.earlyEnd = function() {
            terminex(true);
        }
        node.normalEnd = function() {
            reposition(timeline.keyframes[timeline.keyframes.length-1].position);
            terminex();
        }

        node.cleanup = function() {
            delete node.cleanup;
            globalStyleSheet.deleteRule(0);
            tracked.forEach(function(item) {
                globalStyleSheet.deleteRule(0);
            });
        }

        node.addEventListener("webkitAnimationEnd", node.normalEnd, false);
        
        play(node, timeline.name, timeline.time);

        tracked.forEach(function(item) {
            play(item.node, item.name, timeline.time);
        });
    }

    function createTimeline() {
        var time = 0;
        var lastPosition = position;
        var lastKeyTime = 0;
        var lastDiff = 0;
        var decelOrigin;
        var decelDelta;
        var decelStep = 0;
        var decelTime;
        // var enterVelocity;
        var keyframes = [];

        if (paginated) {
            // When finger is released, decide whether to jump to next/previous page
            // or to snap back to the current page
            if (Math.abs(position - max) > pageLimit || Math.abs(velocity) > kPageEscapeVelocity) {
                if (position > max) {
                    if (max != absMax) {
                        max += viewport+pageSpacing;
                        min += viewport+pageSpacing;

                        // XXXjoe Only difference between this and code below is -viewport. Merge 'em!
                        var totalSpacing = min % viewport;
                        var page = -Math.round((position+viewport-totalSpacing)/(viewport+pageSpacing));
                        dispatch("scrollability-page", animator.node, {page: page});
                    }
                } else {
                    if (min != absMin) {
                        max -= viewport+pageSpacing;
                        min -= viewport+pageSpacing;

                        var totalSpacing = min % viewport;
                        var page = -Math.round((position-viewport-totalSpacing)/(viewport+pageSpacing));
                        dispatch("scrollability-page", animator.node, {page: page});
                    }
                }
            }
        }

        var continues = true;
        while (continues) {
            if (position > max && constrained) {
                if (velocity > 0) {
                    // Slowing down
                    var excess = position - max;
                    var elasticity = (1.0 - excess / bounceLimit);
                    velocity = Math.max(velocity - kBounceDecelRate, 0) * elasticity;
                    // D&&D('slowing down', velocity);
                    position += velocity;
                } else {
                    // Bouncing back
                    if (!decelStep) {
                        decelOrigin = position;
                        decelDelta = max - position;
                    }
                    // D&&D('bouncing back');
                    position = easeOutExpo(decelStep, decelOrigin, decelDelta, bounceTime);
                    continues = ++decelStep <= bounceTime && Math.floor(Math.abs(position)) > max;
                }
            } else if (position < min && constrained) {
                if (velocity < 0) {
                    // if (!enterVelocity) {
                    //     enterVelocity = velocity;
                    // }
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
                        // XXXjoe Record velocity when going past limit, use to shrink bounceTime
                        // decelTime = bounceTime * (-enterVelocity / 10);
                        // D&&D(decelTime);
                    }
                    position = easeOutExpo(decelStep, decelOrigin, decelDelta, bounceTime);
                    continues = ++decelStep <= bounceTime && Math.ceil(position) < min;
                }
            } else {
                continues = Math.floor(Math.abs(velocity)*10) > 0;
                if (!continues)
                    break;

                velocity *= kFriction;
                position += velocity;
            }

            saveKeyframe(!continues);            
            time += kAnimationStep;
        }

        if (paginated) {
            var pageIndex = Math.round(position/(viewport+pageSpacing));
            position = pageIndex * (viewport+pageSpacing);
            saveKeyframe(true);
        } else if (position > max && constrained) {
            position = max;
            saveKeyframe(true);
        } else if (position < min && constrained) {
            position = min;
            saveKeyframe(true);
        }

        var totalTime = keyframes.length ? keyframes[keyframes.length-1].time : 0;

        var name = "scrollability" + (animationIndex++);
        var css = generateCSSKeyframes(animator, keyframes, name, totalTime, offset);

        return {time: totalTime, position: position, keyframes: keyframes, name: name, css: css};

        function saveKeyframe(force) {
            var diff = position - lastPosition;
            // Add a new frame when we've changed direction, or passed the prescribed granularity
            if (force || (time-lastKeyTime >= kKeyframeIncrement || (lastDiff < 0 != diff < 0))) {
                keyframes.push({position: position, time: time});

                tracked.forEach(function(item) {
                    item.keyframes.push({time: time, css: item.callback(position)});
                });

                lastDiff = diff;
                lastPosition = position;
                lastKeyTime = time;
            }
        }
    }

    function update(pos) {
        if (!dispatch("scrollability-scroll", node,
            {direction: animator.direction, position: pos, max: max, min: min})) {
            return;
        }

        reposition(pos);

        if (scrollbar && touchMoved) {
            fadeIn(scrollbar);
        }
    }

    function reposition(pos) {
        // D&&D('move to', pos, offset);
        node.style.webkitTransform = animator.update(pos+offset);
        node.scrollableOffset = offset;

        tracked.forEach(function(item) {
            item.node.style.webkitTransform = item.callback(pos);
        });
    }

    function terminex(showScrollbar) {
        if (scrollbar) {
            if (showScrollbar) {
                fadeIn(scrollbar);
            } else {
                scrollbar.style.opacity = '0';
                scrollbar.style.webkitTransition = 'opacity 0.33s linear';                
            }
        }

        node.removeEventListener("webkitAnimationEnd", node.normalEnd, false);            

        delete node.earlyEnd;
        delete node.normalEnd;
        
        if (!animator.mute) {
            dispatch("scrollability-end", node);
        }
        
    }

    function terminate() {
        terminex();
    }
}

// *************************************************************************************************

function getTouchAnimators(node, touchX, touchY, startTime) {
    var animators = [];
    
    // Get universally scrollable elements
    var candidates = document.querySelectorAll('.scrollable.universal');
    for (var j = 0; j < candidates.length; ++j) {
        findAnimators(candidates[j], animators, touchX, touchY, startTime);
    }

    if (!candidates.length) {
        // Find scrollable nodes that were directly touched
        findAnimators(node, animators, touchX, touchY, startTime);
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
            return animator;
        }
    }
}

function generateCSSKeyframes(animator, keyframes, name, time, offset) {
    var lines = ['@-webkit-keyframes ' + name + ' {'];

    keyframes.forEach(function(keyframe) {
        var percent = (keyframe.time / time) * 100;
        var frame = Math.floor(percent) + '% {'
            + '-webkit-transform: ' + (keyframe.css || animator.update(keyframe.position+offset)) + ';'
            + '}';
        // D&&D(frame);
        lines.push(frame);
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

function createXDirection(node) {
    var parent = node.parentNode;
    var clipper = node.querySelector(".scrollable > .clipper") || node;

    // Necessary to pause animation in order to get correct transform value
    if (node.style.webkitAnimation) {
        node.style.webkitAnimationPlayState = "paused";
    }
    var transform = getComputedStyle(node).webkitTransform;
    var position = new WebKitCSSMatrix(transform).m41 - (node.scrollableOffset||0);

    return {
        node: node,
        min: -clipper.offsetWidth + parent.offsetWidth,
        max: 0,
        position: position,
        viewport: parent.offsetWidth,
        bounce: parent.offsetWidth * kBounceLimit,
        constrained: true,
        
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

        update: function(position) {
            return 'translate3d(' + Math.round(position) + 'px, 0, 0)';
        }
    };
}

function createYDirection(node) {
    var parent = node.parentNode;
    var clipper = node.querySelector(".scrollable > .clipper") || node;

    // Necessary to pause animation in order to get correct transform value
    if (node.style.webkitAnimation) {
        node.style.webkitAnimationPlayState = "paused";
    }

    var transform = getComputedStyle(node).webkitTransform;
    var position = new WebKitCSSMatrix(transform).m42;
    // D&&D('start ' + position);

    return {
        node: node,
        scrollbar: initScrollbar(node),
        position: position,
        min: -clipper.offsetHeight + parent.offsetHeight,
        max: 0,
        viewport: parent.offsetHeight,
        bounce: parent.offsetHeight * kBounceLimit,
        constrained: true,
        
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
        
        update: function(position) {
            return 'translate3d(0, ' + Math.round(position) + 'px, 0)';
        }
    };    
}

function play(node, name, time) {
    if (name) {
        node.style.webkitAnimation = name + " " + time + "ms linear both";
    }
    node.style.webkitAnimationPlayState = name ? "running" : "paused";
}

function fadeIn(node) {
    node.style.webkitTransition = '';
    node.style.opacity = '1';
}

function dispatch(name, target, props) {
    var e = document.createEvent("Events");
    e.initEvent(name, false, true);

    if (props) {
        for (var name in props) {
            e[name] = props[name];
        }
    }

    return target.dispatchEvent(e);
}
