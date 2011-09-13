/* See LICENSE for terms of usage */

"style scrollability/scrollbar.css"

// function D() {
//     if (console.log.apply) {
//         console.log.apply(console, arguments);
//     } else {
//         var args = []; args.push.apply(args, arguments);
//         console.log(args.join(' '));
//     }
// }

// *************************************************************************************************

var isWebkit = "webkitTransform" in document.documentElement.style;
var isiOS5 = isWebkit && /OS 5_/.exec(navigator.userAgent);
var isFirefox = "MozTransform" in document.documentElement.style;
var isTouch = "ontouchstart" in window;

// *************************************************************************************************

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
var kBounceTime = 80;
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

var startX, startY, touchX, touchY, touchDown, touchMoved, justChangedOrientation;
var animationInterval = 0;
var touchAnimators = [];

var directions = {
    'horizontal': createXDirection,
    'vertical': createYDirection
};

var scrollability = exports.scrollability = {
    globalScrolling: false,
    directions: directions,

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
    
    scrollTo: function(element, x, y, animationTime) {
        stopAnimation();

        var animator = createAnimatorForElement(element);
        if (animator) {
            animator = wrapAnimator(animator);
            touchAnimators = [animator];
            touchMoved = true;
            if (animationTime) {
                var orig = element[animator.key];
                var dest = animator.filter(x, y);
                var dir = dest - orig;
                var startTime = new Date().getTime();
                animationInterval = setInterval(function() {
                    var d = new Date().getTime() - startTime;
                    var pos = orig + ((dest-orig) * (d/animationTime));
                    if ((dir < 0 && pos < dest) || (dir > 0 && pos > dest)) {
                        pos = dest;
                    }
                    animator.sync(pos);
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

    touchAnimators = getTouchAnimators(event.target, touchX, touchY, startTime);
    if (!touchAnimators.length && !scrollability.globalScrolling) {
        return true;
    }
    
    var holdTimeout = setTimeout(function() {
        holdTimeout = 0;
        touched = setTouched(touchCandidate);
    }, 50);
        
    var d = document;
    d.addEventListener('touchmove', onTouchMove, false);
    d.addEventListener('touchend', onTouchEnd, false);

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
        if (touchAnimators.length > 1) {
            for (var i = 0; i < touchAnimators.length; ++i) {
                var animator = touchAnimators[i];
                if (animator.disable && animator.disable(touchX, touchY, startX, startY)) {
                    animator.terminate();
                    touchAnimators.splice(i, 1);
                    break;
                }
            }
        }
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
        }
        
        d.removeEventListener('touchmove', onTouchMove, false);
        d.removeEventListener('touchend', onTouchEnd, false);
        touchDown = false;
    }
}

function wrapAnimator(animator, startX, startY, startTime) {
    var constrained = animator.constrained;
    var paginated = animator.paginated;
    var viewport = animator.viewport || 0;
    var scrollbar = animator.scrollbar;
    var position = animator.node[animator.key];
    var min = animator.min;
    var max = animator.max;
    var absMin = min;
    var absMax = Math.round(max/viewport)*viewport;
    var pageSpacing = 0;
    var velocity = 0;
    var decelerating = 0;
    var decelOrigin, decelDelta;
    var bounceTime = paginated ? kPageBounceTime : kBounceTime;
    var bounceLimit = animator.bounce;
    var pageLimit = viewport * kPageLimit;
    var lastTouch = startTouch = animator.filter(startX, startY);
    var lastTime = startTime;
    var stillTime = 0;
    var stillThreshold = 20;
    var snapped = false;
    var locked = false;

    if (paginated) {
        var excess = Math.round(Math.abs(absMin) % viewport);
        var pageCount = ((Math.abs(absMin)-excess) / viewport)+1;
        var pageSpacing = excess / pageCount;

        var positionSpacing = Math.round(position) % viewport;
        var pagePosition = Math.round((position-positionSpacing)/viewport) * viewport;
        min = max = Math.round(pagePosition + absMax)+positionSpacing;
        absMin += pageSpacing;
    }

    if (!dispatch("scrollability-start", animator.node)) {
        return null;        
    }

    if (scrollbar) {
        animator.node.parentNode.appendChild(scrollbar);
    }
    
    function animate(touch, time) {
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
                dispatch("scrollability-lock", animator.node, {direction: animator.direction});
            }
            
            lastTouch = touch;
            velocity = delta / deltaTime;
            
            // Apply resistance along the edges
            if (position > max && absMax == max && constrained) {
                var excess = position - max;
                velocity *= (1.0 - excess / bounceLimit);
            } else if (position < min && absMin == min && constrained) {
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
                            var totalSpacing = min % viewport;
                            var page = -Math.round((position+viewport-totalSpacing)/viewport);
                            dispatch("scrollability-page", animator.node, {page: page});
                        }
                    } else {
                        if (min != absMin) {
                            max -= viewport+pageSpacing;
                            min -= viewport+pageSpacing;
                            var totalSpacing = min % viewport;
                            var page = -Math.round((position-viewport-totalSpacing)/viewport);
                            dispatch("scrollability-page", animator.node, {page: page});
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

                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, bounceTime);
                    return sync(position, ++decelerating <= bounceTime && Math.floor(position) > max);
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
                    position = easeOutExpo(decelerating, decelOrigin, decelDelta, bounceTime);
                    return sync(position, ++decelerating <= bounceTime && Math.ceil(position) < min);
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
        return sync(position, continues);
    }

    function sync(pos, continues) {
        position = pos;

        animator.node[animator.key] = position;
        animator.update(animator.node, position);

        if (!dispatch("scrollability-scroll", animator.node,
            {direction: animator.direction, position: position})) {
            return continues;
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

        return continues;
    }
    
    function terminate() {
        // Snap to the integer endpoint, since position may be a subpixel value while animating
        if (paginated) {
            var pageIndex = Math.round(position/viewport);
            sync(pageIndex * (viewport+pageSpacing));
        } else  if (position > max && constrained) {
            sync(max);
        } else if (position < min && constrained) {
            sync(min);
        }

        // Hide the scrollbar
        if (scrollbar) {
            scrollbar.style.opacity = '0';
            scrollbar.style.webkitTransition = 'opacity 0.33s linear';
        }
        dispatch("scrollability-end", animator.node);
    }
    
    animator.sync = sync;
    animator.animate = animate;
    animator.terminate = terminate;
    return animator;
}

function touchAnimation() {
    var time = new Date().getTime();
    
    // Animate each of the animators
    for (var i = 0; i < touchAnimators.length; ++i) {
        var animator = touchAnimators[i];

        // Translate the x/y touch into the value needed by each of the animators
        var touch = animator.filter(touchX, touchY);
        if (!animator.animate(touch, time)) {
            animator.terminate();
            touchAnimators.splice(i--, 1);
        }
    }
    
    if (!touchAnimators.length) {
        stopAnimation();
    }
}

// *************************************************************************************************

function getTouchAnimators(node, touchX, touchY, startTime) {
    var animators = [];
    findAnimators(node, animators, touchX, touchY, startTime);

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
    for (var i = 0; i < classes.length; ++i) {
        var name = classes[i];
        if (directions[name]) {
            var animator = directions[name](element);
            animator.direction = name;
            animator.key = 'scrollable_'+name;
            animator.paginated = classes.indexOf('paginated') != -1;
            if (!(animator.key in element)) {
                element[animator.key] = animator.initial ? animator.initial(element) : 0;
            }
            return animator;
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

        for (var i = 0; i < touchAnimators.length; ++i) {
            var animator = touchAnimators[i];
            animator.terminate();
        }
        touchAnimators = [];
    }
}

function moveElement(element, x, y) {
    if (isWebkit) {
        element.style.webkitTransform = 'translate3d('
        +(x ? (x+'px') : '0')+','
        +(y ? (y+'px') : '0')+','
        +'0)';      
    } else if (isFirefox) {
        element.style.MozTransform = 'translate('
        +(x ? (x+'px') : '0')+','
        +(y ? (y+'px') : '0')+')';      
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
    var baseline = isiOS5 ? (element.scrollable_vertical||0) : 0;

    return {
        node: element,
        scrollbar: initScrollbar(element),
        min: (-parent.scrollHeight+baseline) + parent.offsetHeight,
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
    document.addEventListener('scroll', onScroll, false);
    document.addEventListener('orientationchange', onOrientationChange, false);
    window.addEventListener('load', onLoad, false);
});
